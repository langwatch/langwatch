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
import * as Sentry from "@sentry/node";
import {
  LambdaClient,
  InvokeWithResponseStreamCommand,
} from "@aws-sdk/client-lambda";

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
        await callPython({
          projectId,
          message,
          onEvent: (event) => sendMessageToClient(ws, event),
        });
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

const callPython = async ({
  projectId,
  message: message,
  onEvent,
}: {
  projectId: string;
  message: StudioClientEvent;
  onEvent: (event: StudioServerEvent) => void;
}) => {
  let reader: ReadableStreamDefaultReader<Uint8Array>;
  try {
    const s3CacheKey = getS3CacheKey(projectId);

    reader = await invokeLambda(message, s3CacheKey);
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

  try {
    if (!reader) {
      throw new Error("No response body");
    }

    const decoder = new TextDecoder();
    const decodeChunk = (chunk: string) => {
      const events = chunk.split("\n\n").filter(Boolean);
      for (const event of events) {
        if (event.startsWith("data: ")) {
          try {
            const serverEvent: StudioServerEvent = JSON.parse(event.slice(6));
            onEvent(serverEvent);

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
            const error_ = new Error(
              `Failed to parse server event, please contact support`
            );
            Sentry.captureException(error_, { extra: { event } });
            throw error_;
          }
        }
      }
    };

    let chunksBuffer = "";
    let events = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const chunk = decoder.decode(value, { stream: true });
      chunksBuffer += chunk;

      if (chunksBuffer.includes("\n\n")) {
        events++;
        const chunks = chunksBuffer.split("\n\n");
        const readyChunks = chunks.slice(0, -1).join("\n\n");
        decodeChunk(readyChunks);
        chunksBuffer = chunks[chunks.length - 1] ?? "";
      }
    }
    if (events === 0) {
      console.error(`Studio invalid response: ${chunksBuffer}`);
    }
  } catch (error) {
    console.error("Error reading stream:", error);
    const node_id =
      "node_id" in message.payload ? message.payload.node_id : undefined;

    if (node_id) {
      onEvent({
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
      onEvent({
        type: "error",
        payload: { message: (error as Error).message },
      });
    }
  } finally {
    reader?.releaseLock();
  }
};

const invokeLambda = async (
  event: StudioClientEvent,
  s3CacheKey: string | undefined
): Promise<ReadableStreamDefaultReader<Uint8Array>> => {
  const payload = {
    body: JSON.stringify(event),
    headers: {
      "Content-Type": "application/json",
      ...(s3CacheKey ? { "X-S3-Cache-Key": s3CacheKey } : {}),
    },
  };

  if (process.env.LANGWATCH_NLP_SERVICE_INVOKE_ARN) {
    const arn = process.env.LANGWATCH_NLP_SERVICE_INVOKE_ARN;
    const region =
      process.env.AWS_REGION ??
      arn.replace(/^arn:aws:lambda:([^:]+):.*$/, "$1");
    const lambda = new LambdaClient({ region });

    const command = new InvokeWithResponseStreamCommand({
      FunctionName: arn,
      InvocationType: "RequestResponse",
      Payload: JSON.stringify({
        rawPath: "/studio/execute",
        requestContext: {
          http: {
            method: "POST",
          },
        },
        ...payload,
      }),
    });

    const { EventStream } = await lambda.send(command);

    if (!EventStream) {
      throw new Error("No payload received from Lambda");
    }

    const webStream = new ReadableStream({
      async start(controller) {
        try {
          for await (const chunk of EventStream) {
            if (chunk.PayloadChunk?.Payload) {
              controller.enqueue(chunk.PayloadChunk.Payload);
            }
            if (chunk.InvokeComplete?.ErrorCode) {
              const error = new Error(
                `Failed run workflow: ${chunk.InvokeComplete.ErrorCode}`
              );
              Sentry.captureException(error, {
                extra: { event, details: chunk.InvokeComplete.ErrorDetails },
              });
              throw error;
            }
          }
          controller.close();
        } catch (error) {
          controller.error(error);
        }
      },
    });

    return webStream.getReader();
  } else {
    const response = await fetch(
      `${process.env.LANGWATCH_NLP_SERVICE}/studio/execute`,
      {
        method: "POST",
        ...payload,
      }
    );

    if (!response.ok) {
      let body = await response.text();
      try {
        body = JSON.stringify(body, null, 2);
      } catch {}
      if (response.status === 422) {
        console.error(
          "Optimization Studio validation failed, some components might be outdated",
          "\n\n",
          JSON.stringify(event, null, 2)
        );
        const error = new Error(
          `Optimization Studio validation failed, some components might be outdated`
        );
        Sentry.captureException(error, { extra: { event } });
        throw error;
      }
      throw new Error(`Failed run workflow: ${response.statusText}\n\n${body}`);
    }

    if (!response.body) {
      throw new Error("No response body");
    }

    return response.body.getReader();
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
