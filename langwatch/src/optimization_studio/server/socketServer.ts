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
  });

  sendMessageToClient(ws, {
    type: "debug",
    payload: { message: "Connected to Optimization Studio socket" },
  });
};

const handleClientMessage = async (
  ws: WebSocket,
  message: StudioClientEvent,
  projectId: string
) => {
  try {
    switch (message.type) {
      case "is_alive":
        await callPython(ws, message);
      case "stop_execution":
      case "execute_component":
        try {
          await callPython(ws, message);
        } catch (error) {
          sendMessageToClient(ws, {
            type: "component_state_change",
            payload: {
              component_id:
                "node_id" in message.payload
                  ? message.payload.node_id
                  : "node" in message.payload
                  ? message.payload.node.id
                  : undefined,
              execution_state: {
                status: "error",
                error: (error as Error).message,
                timestamps: { finished_at: Date.now() },
              },
            },
          });
        }
        break;
      default:
        //@ts-expect-error
        sendErrorToClient(ws, `Unknown event type on server: ${message.type}`);
    }
  } catch (error) {
    console.error("Error handling message:", error);
    sendErrorToClient(ws, (error as Error).message);
  }
};

const callPython = async (ws: WebSocket, event: StudioClientEvent) => {
  let response: Response;
  try {
    response = await fetch(
      `${process.env.LANGWATCH_NLP_SERVICE}/studio/execute`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(event),
      }
    );
  } catch (error) {
    if ((error as any)?.cause?.code === "ECONNREFUSED") {
      throw new Error("Python runtime is unreachable");
    }
    throw error;
  }

  const reader = response.body?.getReader();
  try {
    if (!reader) {
      throw new Error("No response body");
    }

    const decoder = new TextDecoder();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const chunk = decoder.decode(value, { stream: true });
      const events = chunk.split("\n\n").filter(Boolean);

      for (const event of events) {
        if (event.startsWith("data: ")) {
          try {
            const serverEvent: StudioServerEvent = JSON.parse(event.slice(6));
            sendMessageToClient(ws, serverEvent);

            // Close the connection if we receive a completion event
            if (serverEvent.type === "done") {
              return;
            }
          } catch (error) {
            throw new Error(`Failed to parse event: ${event}`);
          }
        }
      }
    }
  } catch (error) {
    console.error("Error reading stream:", error);
    const node_id =
      "node_id" in event.payload
        ? event.payload.node_id
        : "node" in event.payload
        ? event.payload.node.id
        : undefined;

    if (node_id) {
      sendMessageToClient(ws, {
        type: "component_state_change",
        payload: {
          component_id: node_id,
          execution_state: {
            status: "error",
            error: (error as Error).message,
            timestamps: { finished_at: Date.now() },
          },
        },
      });
    } else {
      sendMessageToClient(ws, {
        type: "error",
        payload: { message: (error as Error).message },
      });
    }
  } finally {
    reader?.releaseLock();
  }
};

const sendMessageToClient = (ws: WebSocket, message: StudioServerEvent) => {
  ws.send(JSON.stringify(message));
};

const sendErrorToClient = (ws: WebSocket, errorMessage: string) => {
  sendMessageToClient(ws, {
    type: "error",
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
