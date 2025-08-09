import express from "express";
import { WebSocketServer, WebSocket } from "ws";
import { IncomingMessage } from "http";
import http from "http";
import { readFileSync } from "fs";
import { join } from "path";
import cors from "cors";


import { WebSocketSessionManager } from "./services";
import { envs } from "./configs";
import functionHandlers from "./services/function-handlers";

const sessionManager = new WebSocketSessionManager();

const app = express();
app.use(cors());
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

app.use(express.urlencoded({ extended: false }));

const twimlPath = join(__dirname, "twiml.xml");
const twimlTemplate = readFileSync(twimlPath, "utf-8");

app.get("/public-url", (req, res) => {
  res.json({ publicUrl: envs.PUBLIC_URL });
});


app.all("/twiml", (req, res) => {
  const wsUrl = new URL(envs.PUBLIC_URL);
  wsUrl.protocol = "wss:";
  wsUrl.pathname = `/call`;
  const twimlContent = twimlTemplate.replace("{{WS_URL}}", wsUrl.toString());
  res.type("text/xml").send(twimlContent);
});

app.get("/tools", (req, res) => {
  res.json(functionHandlers.map((f) => f.schema));
});

let currentCall: WebSocket | null = null;
let currentLogs: WebSocket | null = null;

wss.on("connection", (ws: WebSocket, req: IncomingMessage) => {
  const url = new URL(req.url || "", `http://${req.headers.host}`);
  const parts = url.pathname.split("/").filter(Boolean);

  if (parts.length < 1) {
    ws.close();
    return;
  }

  const type = parts[0];

  if (type === "call") {
    if (currentCall) currentCall.close();
    currentCall = ws;
    sessionManager.handleCallConnection(currentCall, envs.OPENAI_API_KEY);
  } else if (type === "logs") {
    if (currentLogs) currentLogs.close();
    currentLogs = ws;
    sessionManager.handleFrontendConnection(currentLogs);
  } else {
    ws.close();
  }
});


server.listen(envs.PORT, () => {
  console.log(`Server running on http://localhost:${envs.PORT}`);
});