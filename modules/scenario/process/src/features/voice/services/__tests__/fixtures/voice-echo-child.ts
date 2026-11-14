// Spike fixture: a fresh child that adopts the handed-off Twilio socket, completes the
// WebSocket handshake itself and echoes every text frame as `echo:<text>`.
// Imports only `ws` and node: plain `node` cannot load the workspace contract graph.
import { IncomingMessage } from "node:http";
import { Socket } from "node:net";
import { WebSocketServer } from "ws";

import { frameText } from "./frame-text.ts";
import { FIXTURE_MEDIA_SOCKET_MESSAGE } from "./media-socket-message.ts";

interface MediaSocketMessage {
  type: string;
  url: string;
  method: string;
  headers: Record<string, string | string[] | undefined>;
  headBase64: string;
}

const server = new WebSocketServer({ noServer: true });

process.on("message", (message: MediaSocketMessage, handle: unknown) => {
  if (message?.type !== FIXTURE_MEDIA_SOCKET_MESSAGE || !(handle instanceof Socket)) return;
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
