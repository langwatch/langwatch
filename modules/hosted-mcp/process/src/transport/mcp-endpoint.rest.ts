import type { IncomingMessage, ServerResponse } from "node:http";

import { RawHttpProtocol } from "@langwatch/api";
import type {
  HostedMcpApiContract,
  HostedMcpHandler,
  McpDoorAccessLog,
  McpDoorAnswer,
  McpDoorBodyRead,
  McpDoorRequest,
  McpSessionRunner,
} from "@langwatch/hosted-mcp-contract";
import { createLogger } from "@langwatch/observability";
import { nowInstant } from "@langwatch/time";

import { MCP_METADATA_SUBTREES, MCP_ROOT_PATHS } from "../rules/mcp-routes.rules.ts";

const logger = createLogger("langwatch:mcp");

const MAX_BODY_BYTES = 10_485_760;

/**
 * Main's hosted MCP root paths, answered over the raw Node request ahead of every route: the
 * endpoint decides each answer and this door writes it, running a session's stream through the
 * endpoint's session runner so the SDK's Streamable HTTP transport writes it (record §8).
 */
export const mcpEndpointDoor = RawHttpProtocol.create<HostedMcpApiContract>({
  paths: MCP_ROOT_PATHS,
  prefixes: MCP_METADATA_SUBTREES,
  open: (app) => {
    const endpoint = app.createHandler();
    return {
      handle: ({ request, response }) =>
        answerMcpExchange({ endpoint, runner: endpoint.sessionRunner, request, response }),
      close: () => endpoint.closeAllSessions(),
    };
  },
});

/**
 * One MCP exchange: the endpoint decides the answer and its access log fields; this writes the
 * answer, runs a stream through the session runner it was handed, and logs the line on close.
 */
export function answerMcpExchange(input: {
  endpoint: Pick<HostedMcpHandler, "answer" | "answerFailure">;
  runner: McpSessionRunner;
  request: IncomingMessage;
  response: ServerResponse;
}): void {
  const { endpoint, runner, request, response } = input;
  const startedAt = nowInstant().epochMilliseconds;
  // Listened for at once: a client that leaves before the answer is decided still gets its line.
  const closedAt = new Promise<number>((resolve) => {
    response.once("close", () => resolve(nowInstant().epochMilliseconds));
  });
  const exchange: McpDoorRequest = {
    method: request.method ?? "GET",
    url: request.url ?? "",
    headers: request.headers,
    remoteAddress: request.socket.remoteAddress,
    readBody: () => readBody(request),
  };

  void endpoint.answer(exchange).then(({ answer, accessLog, onClosed }) => {
    logOnClose({ accessLog, onClosed, response, startedAt, closedAt });
    return writeAnswer({ answer, runner, request, response }).catch((error: unknown) => {
      const failure = endpoint.answerFailure({ error, url: exchange.url });
      // A stream failing after its head was written has nothing left to answer.
      if (response.headersSent) return;
      return writeAnswer({ answer: failure, runner, request, response });
    });
  });
}

async function writeAnswer(input: {
  answer: McpDoorAnswer;
  runner: McpSessionRunner;
  request: IncomingMessage;
  response: ServerResponse;
}): Promise<void> {
  const { answer, request, response } = input;
  for (const [name, value] of Object.entries(answer.headers)) response.setHeader(name, value);
  if (answer.kind === "stream") {
    const { transport, apiKey, body } = answer.stream;
    await input.runner.runAs(apiKey, () => transport.handleRequest(request, response, body));
    return;
  }
  if (answer.kind === "empty") {
    response.writeHead(answer.status);
    response.end();
    return;
  }
  const body = JSON.stringify(answer.body);
  response.writeHead(answer.status, {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(body),
  });
  response.end(body);
}

/** The endpoint's access log fields, with the status and duration, once the response is done. */
function logOnClose(input: {
  accessLog: McpDoorAccessLog;
  onClosed: (status: number) => void;
  response: ServerResponse;
  startedAt: number;
  closedAt: Promise<number>;
}): void {
  const { accessLog, onClosed, response, startedAt, closedAt } = input;
  void closedAt.then((closedAtMs) => {
    onClosed(response.statusCode);
    try {
      const durationMs = closedAtMs - startedAt;
      logger.info({ ...accessLog, status: response.statusCode, durationMs }, "MCP request");
    } catch {
      // Logging must not break request handling.
    }
  });
}

/** The body as text, read once; past the cap the rest is drained unread. */
function readBody(request: IncomingMessage): Promise<McpDoorBodyRead> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let totalBytes = 0;
    let refused = false;
    request.on("data", (chunk: Buffer) => {
      if (refused) return;
      totalBytes += chunk.length;
      if (totalBytes > MAX_BODY_BYTES) {
        refused = true;
        resolve({ kind: "too-large" });
        request.resume();
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => {
      if (!refused) resolve({ kind: "read", body: Buffer.concat(chunks).toString("utf-8") });
    });
    request.on("error", reject);
  });
}
