import { WebSocket } from "ws";

export interface Session {
  twilioConn?: WebSocket;
  frontendConn?: WebSocket;
  modelConn?: WebSocket;
  config?: any;
  streamSid?: string;
}

export interface FunctionCallItem {
  name: string;
  arguments: string;
  call_id?: string;
}

export interface FunctionSchema {
  name: string;
  type: "function";
  description?: string;
  parameters: {
    type: string;
    properties: Record<string, { type: string; description?: string }>;
    required: string[];
  };
}

export interface FunctionHandler {
  schema: FunctionSchema;
  handler: (args: any) => Promise<string>;
}



export enum ConnectionType {
  TWILIO = 'twilio',
  FRONTEND = 'frontend',
  MODEL = 'model'
}

export enum SessionEvent {
  CONNECTION_ESTABLISHED = 'connection_established',
  CONNECTION_CLOSED = 'connection_closed',
  FUNCTION_CALL_STARTED = 'function_call_started',
  FUNCTION_CALL_COMPLETED = 'function_call_completed',
  FUNCTION_CALL_ERROR = 'function_call_error',
  SESSION_RESET = 'session_reset',
  ERROR = 'error'
}

export interface SessionData {
  twilioConn?: WebSocket;
  frontendConn?: WebSocket;
  modelConn?: WebSocket;
  streamSid?: string;
  saved_config?: any;
  lastAssistantItem?: string;
  responseStartTimestamp?: number;
  latestMediaTimestamp?: number;
  openAIApiKey?: string;
}

export interface ConnectionStats {
  totalConnections: number;
  activeConnections: number;
  connectionDuration: number;
  lastActivity: Date;
}