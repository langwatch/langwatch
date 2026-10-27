// Spike fixture: a fresh child that adopts the handed-off Twilio socket, completes the
// WebSocket handshake itself and echoes every text frame as `echo:<text>`.
// Imports only `ws` and node: plain `node` cannot load the workspace contract graph.
import { IncomingMessage } from "node:http";
import { Socket } from "node:net";
import { WebSocketServer, type RawData } from "ws";

function frameText(data: RawData): string {
  if (Array.isArray(data)) return Buffer.concat(data).toString("utf8");
  if (Buffer.isBuffer(data)) return data.toString("utf8");
  return Buffer.from(data).toString("utf8");
}

const MEDIA_SOCKET_MESSAGE = "voice:twilio-media-socket";

interface MediaSocketMessage {
  type: string;
  url: string;
  method: string;
  headers: Record<string, string | string[] | undefined>;
  headBase64: string;
}

const server = new WebSocketServer({ noServer: true });

process.on("message", (message: MediaSocketMessage, handle: unknown) => {
  if (message?.type !== MEDIA_SOCKET_MESSAGE || !(handle instanceof Socket)) return;
  const request = Object.assign(new IncomingMessage(handle), {
    url: message.url,
    method: message.method,
    headers: message.headers as IncomingMessage["headers"],
  });
  server.handleUpgrade(request, handle, Buffer.from(message.headBase64, "base64"), (ws) => {
    ws.on("message", (data) => ws.send(`echo:${frameText(data)}`));
    ws.on("close", () => process.exit(0));
  });
});
