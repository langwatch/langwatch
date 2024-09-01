import { ServerResponse, type IncomingMessage } from "http";
import type { Duplex } from "stream";
import type { UrlWithParsedQuery } from "url";
import { WebSocketServer, type WebSocket } from "ws";
import { backendHasTeamProjectPermission } from "../../server/api/permission";
import { authOptions } from "../../server/auth";
import { getServerSession } from "next-auth";
import { parse as parseCookie } from "cookie";
import { prisma } from "../../server/db";
import type { StudioClientEvent, StudioServerEvent } from "../types/events";

const wss = new WebSocketServer({ noServer: true });

const handleConnection = (
  ws: WebSocket,
  request: IncomingMessage,
  projectId: string
) => {
  console.log(`New WebSocket connection established for project: ${projectId}`);

  ws.on("message", (message: string) => {
    try {
      const parsedMessage: StudioClientEvent = JSON.parse(message);
      void handleClientMessage(ws, parsedMessage, projectId);
    } catch (error) {
      console.error("Error processing message:", error);
      sendErrorToClient(ws, "Invalid message format");
    }
  });

  ws.on("close", () => {
    console.log(`WebSocket connection closed for project: ${projectId}`);
    // Perform any cleanup if necessary
  });

  // Send a welcome message to the client
  sendMessageToClient(ws, {
    type: "debug",
    payload: { message: "Connected to Optimization Studio" },
  });
};

const handleClientMessage = async (
  ws: WebSocket,
  message: StudioClientEvent,
  projectId: string
) => {
  switch (message.type) {
    case "execute_component":
      // Fetch and send optimization data
      sendMessageToClient(ws, {
        type: "debug",
        payload: { message: "Optimization data" },
      });
      break;
    // Add more message types as needed
    default:
      sendErrorToClient(ws, "Unknown message type");
  }
};

const sendMessageToClient = (ws: WebSocket, message: StudioServerEvent) => {
  ws.send(JSON.stringify(message));
};

const sendErrorToClient = (ws: WebSocket, errorMessage: string) => {
  sendMessageToClient(ws, {
    type: "debug",
    payload: { message: errorMessage },
  });
};

export const handleUpgrade = async (
  request: IncomingMessage,
  socket: Duplex,
  head: Buffer,
  parsedUrl: UrlWithParsedQuery
) => {
  const cookies = parseCookie(request.headers.cookie ?? "");
  (request as any).cookies = cookies;
  const req = request as IncomingMessage & { cookies: Record<string, string> };

  const session = await getServerSession(
    req,
    new ServerResponse(req),
    authOptions(req)
  );
  if (!session) {
    socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
    socket.destroy();
    return;
  }

  const searchParams = new URLSearchParams(parsedUrl.search ?? "");
  const projectId = searchParams.get("projectId");
  if (!projectId) {
    socket.write("HTTP/1.1 400 Bad Request\r\n\r\n");
    socket.destroy();
    return;
  }

  const hasPermission = await backendHasTeamProjectPermission(
    { prisma, session },
    { projectId },
    "OPTIMIZATION_STUDIO_MANAGE"
  );
  if (!hasPermission) {
    socket.write("HTTP/1.1 403 Forbidden\r\n\r\n");
    socket.destroy();
    return;
  }

  wss.handleUpgrade(request, socket, head, (ws) => {
    const searchParams = new URLSearchParams(parsedUrl.search ?? "");

    const projectId = searchParams.get("projectId");
    if (!projectId) {
      ws.close(1008, "Missing projectId");
      return;
    }
    wss.emit("connection", ws, request);
    handleConnection(ws, request, projectId);
  });
};
