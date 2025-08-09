import { RawData, WebSocket } from "ws";
import { EventEmitter } from "events";
import { ConnectionStats, ConnectionType, SessionData, SessionEvent } from "../interfaces";
import functionHandlers from "./function-handlers";


export class WebSocketSessionManager extends EventEmitter {
  private session: SessionData = {};
  private connectionStartTime?: Date;
  private readonly maxReconnectAttempts = 3;
  private reconnectAttempts = 0;
  private reconnectTimer?: NodeJS.Timeout;

  constructor() {
    super();
    this.setupErrorHandling();
  }

  private setupErrorHandling(): void {
    this.on('error', (error) => {
      console.error('SessionManager Error:', error);
    });
  }

  public async handleCallConnection(ws: WebSocket, openAIApiKey: string): Promise<void> {
    try {
      await this.cleanupConnection(this.session.twilioConn);
      this.session.twilioConn = ws;
      this.session.openAIApiKey = openAIApiKey;
      this.connectionStartTime = new Date();

      this.setupWebSocketHandlers(ws, ConnectionType.TWILIO);
      this.emit(SessionEvent.CONNECTION_ESTABLISHED, ConnectionType.TWILIO);
    } catch (error) {
      this.emit(SessionEvent.ERROR, { type: 'call_connection', error });
      throw error;
    }
  }

  public async handleFrontendConnection(ws: WebSocket): Promise<void> {
    try {
      await this.cleanupConnection(this.session.frontendConn);
      this.session.frontendConn = ws;

      this.setupWebSocketHandlers(ws, ConnectionType.FRONTEND);
      this.emit(SessionEvent.CONNECTION_ESTABLISHED, ConnectionType.FRONTEND);
    } catch (error) {
      this.emit(SessionEvent.ERROR, { type: 'frontend_connection', error });
      throw error;
    }
  }

  private setupWebSocketHandlers(ws: WebSocket, type: ConnectionType): void {
    ws.on("message", (data: RawData) => {
      try {
        if (type === ConnectionType.TWILIO) {
          this.handleTwilioMessage(data);
        } else if (type === ConnectionType.FRONTEND) {
          this.handleFrontendMessage(data);
        }
      } catch (error) {
        this.emit(SessionEvent.ERROR, { type: 'message_handling', error, connectionType: type });
      }
    });

    ws.on("error", (error) => {
      this.emit(SessionEvent.ERROR, { type: 'websocket_error', error, connectionType: type });
      this.handleConnectionError(type, error);
    });

    ws.on("close", (code, reason) => {
      this.handleConnectionClose(type, code, reason?.toString());
    });
  }

  private handleConnectionError(type: ConnectionType, error: Error): void {
    console.error(`${type} connection error:`, error);

    if (type === ConnectionType.MODEL && this.reconnectAttempts < this.maxReconnectAttempts) {
      this.scheduleReconnect();
    }
  }

  private handleConnectionClose(type: ConnectionType, code?: number, reason?: string): void {
    console.log(`${type} connection closed. Code: ${code}, Reason: ${reason}`);

    switch (type) {
      case ConnectionType.TWILIO:
        this.cleanupConnection(this.session.modelConn);
        this.cleanupConnection(this.session.twilioConn);
        this.session.twilioConn = undefined;
        this.session.modelConn = undefined;
        this.resetSessionData();
        break;

      case ConnectionType.FRONTEND:
        this.cleanupConnection(this.session.frontendConn);
        this.session.frontendConn = undefined;
        break;

      case ConnectionType.MODEL:
        this.closeModel();
        break;
    }

    this.emit(SessionEvent.CONNECTION_CLOSED, { type, code, reason });

    if (!this.hasActiveConnections()) {
      this.resetSession();
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
    }

    const delay = Math.pow(2, this.reconnectAttempts) * 1000; // Exponential backoff

    this.reconnectTimer = setTimeout(() => {
      this.reconnectAttempts++;
      this.tryConnectModel();
    }, delay);
  }

  private async handleFunctionCall(item: { name: string; arguments: string; call_id?: string }): Promise<any> {
    this.emit(SessionEvent.FUNCTION_CALL_STARTED, { name: item.name, call_id: item.call_id });
    try {
      console.log("Handling function call:", item);
      const fnDef = functionHandlers.find((f) => f.schema.name === item.name);
      if (!fnDef) {
        throw new Error(`No handler found for function: ${item.name}`);
      }
      let args: unknown;
      try {
        args = JSON.parse(item.arguments);
      } catch {
        const errorResult = { error: "Invalid JSON arguments for function call." };
        this.emit(SessionEvent.FUNCTION_CALL_ERROR, { name: item.name, error: errorResult });
        return JSON.stringify(errorResult);
      }

      console.log("Calling function:", fnDef.schema.name, args);
      const result = await fnDef.handler(args as any);

      this.emit(SessionEvent.FUNCTION_CALL_COMPLETED, {
        name: item.name,
        call_id: item.call_id,
        result
      });

      return result;
    } catch (err: any) {
      console.error("Error running function:", err);
      const errorResult = {
        error: `Error running function ${item.name}: ${err.message}`,
      };

      this.emit(SessionEvent.FUNCTION_CALL_ERROR, {
        name: item.name,
        call_id: item.call_id,
        error: errorResult
      });

      return JSON.stringify(errorResult);
    }
  }

  private handleTwilioMessage(data: RawData): void {
    const msg = this.parseMessage(data);
    if (!msg) return;

    switch (msg.event) {
      case "start":
        this.session.streamSid = msg.start.streamSid;
        this.session.latestMediaTimestamp = 0;
        this.session.lastAssistantItem = undefined;
        this.session.responseStartTimestamp = undefined;
        this.tryConnectModel();
        break;

      case "media":
        this.session.latestMediaTimestamp = msg.media.timestamp;
        if (this.isOpen(this.session.modelConn)) {
          this.jsonSend(this.session.modelConn, {
            type: "input_audio_buffer.append",
            audio: msg.media.payload,
          });
        }
        break;

      case "close":
        this.closeAllConnections();
        break;
    }
  }

  private handleFrontendMessage(data: RawData): void {
    const msg = this.parseMessage(data);
    if (!msg) return;

    if (this.isOpen(this.session.modelConn)) {
      this.jsonSend(this.session.modelConn, msg);
    }

    if (msg.type === "session.update") {
      this.session.saved_config = msg.session;
    }
  }

  private async tryConnectModel(): Promise<void> {
    if (!this.session.twilioConn || !this.session.streamSid || !this.session.openAIApiKey) {
      return;
    }

    if (this.isOpen(this.session.modelConn)) {
      return;
    }

    try {
      this.session.modelConn = new WebSocket(
        "wss://api.openai.com/v1/realtime?model=gpt-4o-realtime-preview-2024-12-17",
        {
          headers: {
            Authorization: `Bearer ${this.session.openAIApiKey}`,
            "OpenAI-Beta": "realtime=v1",
          },
        }
      );

      this.setupModelConnection();
      this.reconnectAttempts = 0;
    } catch (error) {
      console.error('Failed to connect to model:', error);
      this.emit(SessionEvent.ERROR, { type: 'model_connection', error });
      throw error;
    }
  }

  private setupModelConnection(): void {
    if (!this.session.modelConn) return;

    this.session.modelConn.on("open", () => {
      const config = this.session.saved_config || {};
      this.jsonSend(this.session.modelConn, {
        type: "session.update",
        session: {
          modalities: ["text", "audio"],
          turn_detection: { type: "server_vad" },
          voice: "ash",
          input_audio_transcription: { model: "whisper-1" },
          input_audio_format: "g711_ulaw",
          output_audio_format: "g711_ulaw",
          ...config,
        },
      });
      this.emit(SessionEvent.CONNECTION_ESTABLISHED, ConnectionType.MODEL);
    });

    this.session.modelConn.on("message", (data: RawData) => this.handleModelMessage(data));
    this.session.modelConn.on("error", (error) => this.handleConnectionError(ConnectionType.MODEL, error));
    this.session.modelConn.on("close", (code, reason) =>
      this.handleConnectionClose(ConnectionType.MODEL, code, reason?.toString())
    );
  }

  private handleModelMessage(data: RawData): void {
    const event = this.parseMessage(data);
    if (!event) return;

    this.jsonSend(this.session.frontendConn, event);

    switch (event.type) {
      case "input_audio_buffer.speech_started":
        this.handleTruncation();
        break;

      case "response.audio.delta":
        this.handleAudioDelta(event);
        break;

      case "response.output_item.done":
        this.handleOutputItemDone(event);
        break;
    }
  }

  private handleAudioDelta(event: any): void {
    if (this.session.twilioConn && this.session.streamSid) {
      if (this.session.responseStartTimestamp === undefined) {
        this.session.responseStartTimestamp = this.session.latestMediaTimestamp || 0;
      }

      if (event.item_id) {
        this.session.lastAssistantItem = event.item_id;
      }

      this.jsonSend(this.session.twilioConn, {
        event: "media",
        streamSid: this.session.streamSid,
        media: { payload: event.delta },
      });

      this.jsonSend(this.session.twilioConn, {
        event: "mark",
        streamSid: this.session.streamSid,
      });
    }
  }

  private async handleOutputItemDone(event: any): Promise<void> {
    const { item } = event;
    if (item.type === "function_call") {
      try {
        const output = await this.handleFunctionCall(item);
        if (this.session.modelConn) {
          this.jsonSend(this.session.modelConn, {
            type: "conversation.item.create",
            item: {
              type: "function_call_output",
              call_id: item.call_id,
              output: JSON.stringify(output),
            },
          });
          this.jsonSend(this.session.modelConn, { type: "response.create" });
        }
      } catch (err) {
        console.error("Error handling function call:", err);
        this.emit(SessionEvent.ERROR, { type: 'function_call', error: err });
      }
    }
  }

  private handleTruncation(): void {
    if (!this.session.lastAssistantItem || this.session.responseStartTimestamp === undefined) {
      return;
    }

    const elapsedMs = (this.session.latestMediaTimestamp || 0) - (this.session.responseStartTimestamp || 0);
    const audio_end_ms = Math.max(0, elapsedMs);

    if (this.isOpen(this.session.modelConn)) {
      this.jsonSend(this.session.modelConn, {
        type: "conversation.item.truncate",
        item_id: this.session.lastAssistantItem,
        content_index: 0,
        audio_end_ms,
      });
    }

    if (this.session.twilioConn && this.session.streamSid) {
      this.jsonSend(this.session.twilioConn, {
        event: "clear",
        streamSid: this.session.streamSid,
      });
    }

    this.resetSessionData();
  }

  private resetSessionData(): void {
    this.session.lastAssistantItem = undefined;
    this.session.responseStartTimestamp = undefined;
  }

  private closeModel(): void {
    this.cleanupConnection(this.session.modelConn);
    this.session.modelConn = undefined;

    if (!this.hasActiveConnections()) {
      this.resetSession();
    }
  }

  public async closeAllConnections(): Promise<void> {
    const closingPromises: Promise<void>[] = [];

    if (this.session.twilioConn) {
      closingPromises.push(this.cleanupConnection(this.session.twilioConn));
      this.session.twilioConn = undefined;
    }

    if (this.session.modelConn) {
      closingPromises.push(this.cleanupConnection(this.session.modelConn));
      this.session.modelConn = undefined;
    }

    if (this.session.frontendConn) {
      closingPromises.push(this.cleanupConnection(this.session.frontendConn));
      this.session.frontendConn = undefined;
    }

    await Promise.all(closingPromises);
    this.resetSession();
  }

  private resetSession(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = undefined;
    }

    this.session = {};
    this.connectionStartTime = undefined;
    this.reconnectAttempts = 0;
    this.emit(SessionEvent.SESSION_RESET);
  }

  private async cleanupConnection(ws?: WebSocket): Promise<void> {
    if (!this.isOpen(ws)) return;

    return new Promise((resolve) => {
      ws.once('close', () => resolve());
      ws.close();

      // Force close after timeout
      setTimeout(() => {
        if (ws.readyState !== WebSocket.CLOSED) {
          ws.terminate();
        }
        resolve();
      }, 5000);
    });
  }

  private parseMessage(data: RawData): any {
    try {
      const message = JSON.parse(data.toString());
      return message;
    } catch (error) {
      console.warn('Failed to parse message:', error);
      return null;
    }
  }

  private jsonSend(ws: WebSocket | undefined, obj: unknown): boolean {
    if (!this.isOpen(ws)) return false;
    try {
      ws.send(JSON.stringify(obj));
      return true;
    } catch (error) {
      console.error('Failed to send JSON:', error);
      this.emit(SessionEvent.ERROR, { type: 'json_send', error });
      return false;
    }
  }

  private isOpen(ws?: WebSocket): ws is WebSocket {
    return !!ws && ws.readyState === WebSocket.OPEN;
  }

  private hasActiveConnections(): boolean {
    return !!(this.session.twilioConn || this.session.frontendConn || this.session.modelConn);
  }

  public getSessionInfo(): Readonly<SessionData> {
    return { ...this.session };
  }

  public isConnected(): boolean {
    return this.hasActiveConnections();
  }

  public getConnectionStats(): ConnectionStats {
    const activeConnections = [
      this.session.twilioConn,
      this.session.frontendConn,
      this.session.modelConn
    ].filter(conn => this.isOpen(conn)).length;

    return {
      totalConnections: activeConnections,
      activeConnections,
      connectionDuration: this.connectionStartTime
        ? Date.now() - this.connectionStartTime.getTime()
        : 0,
      lastActivity: new Date()
    };
  }

  public async healthCheck(): Promise<{ status: 'healthy' | 'unhealthy'; details: any }> {
    const stats = this.getConnectionStats();
    const isHealthy = this.hasActiveConnections();
    return {
      status: isHealthy ? 'healthy' : 'unhealthy',
      details: {
        connections: stats,
        session: {
          streamSid: !!this.session.streamSid,
          hasApiKey: !!this.session.openAIApiKey,
          hasConfig: !!this.session.saved_config
        },
        reconnectAttempts: this.reconnectAttempts
      }
    };
  }

  public async destroy(): Promise<void> {
    this.removeAllListeners();
    await this.closeAllConnections();
  }
}