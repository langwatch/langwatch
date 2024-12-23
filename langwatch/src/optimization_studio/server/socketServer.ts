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
import { addEnvs, getS3CacheKey } from "./addEnvs";
import { loadDatasets } from "./loadDatasets";

const wss = new WebSocketServer({ noServer: true });

const handleConnection = (
  ws: WebSocket,
  request: IncomingMessage,
  projectId: string
) => {
  ws.on("message", (message: string) => {
    try {
      const parsedMessage: StudioClientEvent = JSON.parse(message);
      void handleClientMessage(ws, parsedMessage, projectId);
    } catch (error) {
      console.error("Error processing message:", error);
      sendErrorToClient(ws, "Invalid message format");
    }
  });

  sendMessageToClient(ws, {
    type: "debug",
    payload: { message: "Connected to Optimization Studio socket" },
  });
};

const handleClientMessage = async (
  ws: WebSocket,
  messageWithoutEnvs: StudioClientEvent,
  projectId: string
) => {
  try {
    const message = await loadDatasets(
      await addEnvs(messageWithoutEnvs, projectId),
      projectId
    );

    switch (message.type) {
      case "is_alive":
      case "stop_execution":
      case "execute_component":
      case "execute_flow":
      case "execute_evaluation":
      case "stop_evaluation_execution":
      case "execute_optimization":
      case "stop_optimization_execution":
        await callPython(ws, message, projectId);
        break;
      default:
        //@ts-expect-error
        sendErrorToClient(ws, `Unknown event type on server: ${message.type}`);
    }
  } catch (error) {
    console.error("Error handling message:", error);
    if (
      "node_id" in messageWithoutEnvs.payload &&
      messageWithoutEnvs.payload.node_id
    ) {
      handleComponentError(
        ws,
        messageWithoutEnvs.payload.node_id,
        error as Error
      );
    } else {
      sendErrorToClient(ws, (error as Error).message);
    }
  }
};

const handleComponentError = (
  ws: WebSocket,
  node_id: string | undefined,
  error: Error
) => {
  sendMessageToClient(ws, {
    type: "component_state_change",
    payload: {
      component_id: node_id ?? "",
      execution_state: {
        status: "error",
        error: error.message,
        timestamps: { finished_at: Date.now() },
      },
    },
  });
};

const callPython = async (
  ws: WebSocket,
  event: StudioClientEvent,
  projectId: string
) => {
  let response: Response;
  try {
    const s3CacheKey = getS3CacheKey(projectId);

    response = await fetch(
      `${process.env.LANGWATCH_NLP_SERVICE}/studio/execute`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(s3CacheKey ? { "X-S3-Cache-Key": s3CacheKey } : {}),
        },
        body: JSON.stringify(event),
      }
    );
    if (!response.ok) {
      let body = await response.text();
      try {
        body = JSON.stringify(body, null, 2);
      } catch {}
      throw new Error(
        `Failed to call Python: ${response.statusText}\n\n${body}`
      );
    }
  } catch (error) {
    if (
      (error as any)?.cause?.code === "ECONNREFUSED" ||
      (error as any)?.cause?.code === "ETIMEDOUTA"
    ) {
      throw new Error("Python runtime is unreachable");
    }
    if (
      (error as any)?.message === "fetch failed" &&
      (error as any)?.cause.code
    ) {
      throw new Error((error as any)?.cause.code);
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
            console.error(
              "Failed to parse event:",
              error,
              JSON.stringify(event, undefined, 2)
            );
            throw new Error(`Failed to parse event: ${event}`);
          }
        }
      }
    }
  } catch (error) {
    console.error("Error reading stream:", error);
    const node_id =
      "node_id" in event.payload ? event.payload.node_id : undefined;

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
    "WORKFLOWS_MANAGE"
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
