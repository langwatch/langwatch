/**
 * A minimal MCP SSE client for tests: opens the stream, keeps consuming it in
 * the background, and posts messages back over the endpoint the stream names.
 * Kept apart from the scenarios so the suites read as behaviour rather than
 * as transport plumbing.
 */
import { createHash } from "node:crypto";
import { createServer, type Server } from "node:http";
import type { Cluster, Redis } from "ioredis";
import { createMcpHandler, type McpHandler } from "../../handler";

export const SSE_SESSION_PREFIX = "mcp:sse:session:";
export const SSE_SESSION_SET_PREFIX = "mcp:sse:sessions_by_key:";
export const SESSION_PREFIX = "mcp:session:";
export const SESSION_SET_PREFIX = "mcp:sessions_by_key:";

/** How long a helper waits for the server before giving up with its own error. */
const HARNESS_TIMEOUT_MS = 20_000;

export interface JsonRpcMessage {
  id?: number | string;
  result?: Record<string, unknown>;
  error?: Record<string, unknown>;
  method?: string;
}

export interface OpenSseStream {
  status: number;
  endpoint: string;
  sessionId: string;
  messages: JsonRpcMessage[];
  waitFor: (match: (m: JsonRpcMessage) => boolean) => Promise<JsonRpcMessage>;
  close: () => void;
}

/**
 * Names the Redis set that holds one project's session ids for a transport.
 *
 * The digest namespaces a bucket of session ids, it does not protect the key:
 * anything able to read it already holds the key it was derived from. The
 * production side derives it the same way, and an equivalent alert on that
 * line is dismissed for the same reason.
 */
function sessionSetKey({
  setPrefix,
  apiKey,
}: {
  setPrefix: string;
  apiKey: string;
}): string {
  const digest = createHash("sha256").update(apiKey).digest("hex").slice(0, 16);
  return `${setPrefix}${digest}`;
}

/**
 * Drops every session record a key owns, for both transports.
 *
 * Session records outlive the process that wrote them, and the streamable
 * ones carry a 30-day TTL, so a suite that leaves them behind spends the
 * project's concurrent-session budget on its own debris: the per-project
 * limit counts both transports together, and after enough runs the first
 * connection of a fresh run is the one that gets refused.
 */
export async function clearRecordedSessions({
  redis,
  apiKey,
}: {
  redis: Redis | Cluster;
  apiKey: string;
}): Promise<void> {
  for (const [setPrefix, sessionPrefix] of [
    [SSE_SESSION_SET_PREFIX, SSE_SESSION_PREFIX],
    [SESSION_SET_PREFIX, SESSION_PREFIX],
  ] as const) {
    const setKey = sessionSetKey({ setPrefix, apiKey });
    for (const id of await redis.smembers(setKey)) {
      await redis.del(`${sessionPrefix}${id}`);
    }
    await redis.del(setKey);
  }
}

/** The Redis set of SSE session ids for a key, for suites that seed it. */
export function sseSessionSetKey(apiKey: string): string {
  return sessionSetKey({ setPrefix: SSE_SESSION_SET_PREFIX, apiKey });
}

function rejectAfter(ms: number, message: string): Promise<never> {
  return new Promise<never>((_, reject) => {
    // Unreferenced so the loser of a race does not hold the event loop open
    // for its full duration and stall the file's teardown.
    setTimeout(() => reject(new Error(message)), ms).unref();
  });
}

/**
 * Two handlers, each on its own server, sharing one Redis.
 *
 * That is the shape of production: replicas behind a load balancer with no
 * session affinity, each with its own session map and relay subscriber, with
 * only Redis in common. A suite that wants to prove cross-replica behaviour
 * cannot do it with one handler.
 */
export async function startReplicaPair({
  redis,
  apiKeys,
}: {
  redis: Redis | Cluster;
  apiKeys: string[];
}): Promise<ReplicaPair> {
  for (const apiKey of apiKeys) {
    await clearRecordedSessions({ redis, apiKey });
  }

  const handlers: McpHandler[] = [];
  const servers: Server[] = [];
  const urls: string[] = [];
  try {
    for (let i = 0; i < 2; i++) {
      const handler = createMcpHandler();
      const server = createServer((req, res) =>
        handler.handleRequest(req, res),
      );
      await new Promise<void>((resolve) =>
        server.listen(0, "127.0.0.1", resolve),
      );
      const address = server.address();
      if (typeof address !== "object" || !address) {
        throw new Error("a replica reported no address after listening");
      }
      const port = address.port;
      handlers.push(handler);
      servers.push(server);
      urls.push(`http://127.0.0.1:${port}`);
    }
  } catch (err) {
    // Failing here returns no `stop()`, so nothing would ever put the previous
    // App back and every later suite in this worker would read the one
    // installed above. Undo it on the way out.
    for (const server of servers) {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
    globalForApp.__langwatch_app = previousApp;
    throw err;
  }

  return {
    urlA: urls[0]!,
    urlB: urls[1]!,
    async stop() {
      for (const handler of handlers) await handler.closeAllSessions();
      for (const server of servers) {
        await new Promise<void>((resolve) => server.close(() => resolve()));
      }
      for (const apiKey of apiKeys) {
        await clearRecordedSessions({ redis, apiKey });
      }
    },
  };
}

export interface ReplicaPair {
  urlA: string;
  urlB: string;
  stop: () => Promise<void>;
}

/**
 * Opens `GET /sse` and keeps consuming the stream in the background, so the
 * test can assert on replies that arrive after the POST that triggered them
 * has already been answered.
 */
export async function openSseStream({
  baseUrl,
  apiKey,
}: {
  baseUrl: string;
  apiKey: string;
}): Promise<OpenSseStream> {
  const abort = new AbortController();
  const res = await fetch(`${baseUrl}/sse`, {
    method: "GET",
    headers: { authorization: `Bearer ${apiKey}` },
    signal: abort.signal,
  });

  // A refusal answers with a body that is not a stream, and waiting for an
  // endpoint event on it would hang until the whole suite times out with no
  // clue which call was stuck.
  if (res.status !== 200 || !res.body) {
    abort.abort();
    throw new Error(
      `GET /sse answered ${res.status}, no stream to read: ${await res
        .text()
        .catch(() => "")}`,
    );
  }

  const messages: JsonRpcMessage[] = [];
  const waiters: {
    match: (m: JsonRpcMessage) => boolean;
    resolve: (m: JsonRpcMessage) => void;
  }[] = [];
  let resolveEndpoint!: (path: string) => void;
  const endpointArrived = new Promise<string>((resolve) => {
    resolveEndpoint = resolve;
  });

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  void (async () => {
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let boundary = buffer.indexOf("\n\n");
        while (boundary !== -1) {
          const frame = buffer.slice(0, boundary);
          buffer = buffer.slice(boundary + 2);
          boundary = buffer.indexOf("\n\n");

          const data = /^data:\s*(.*)$/m.exec(frame)?.[1]?.trim();
          if (data === undefined) continue;
          const event =
            /^event:\s*(.*)$/m.exec(frame)?.[1]?.trim() ?? "message";
          if (event === "endpoint") {
            resolveEndpoint(data);
            continue;
          }
          try {
            const parsed = JSON.parse(data) as JsonRpcMessage;
            messages.push(parsed);
            for (let i = waiters.length - 1; i >= 0; i--) {
              const waiter = waiters[i]!;
              if (waiter.match(parsed)) {
                waiters.splice(i, 1);
                waiter.resolve(parsed);
              }
            }
          } catch {
            // Not a JSON-RPC frame — keep reading.
          }
        }
      }
    } catch {
      // The stream was aborted by close() — expected at the end of a test.
    }
  })();

  const endpoint = await Promise.race([
    endpointArrived,
    rejectAfter(
      HARNESS_TIMEOUT_MS,
      "the stream opened but never named its message endpoint",
    ),
  ]).catch((err: unknown) => {
    abort.abort();
    throw err;
  });
  const sessionId =
    new URL(endpoint, "http://localhost").searchParams.get("sessionId") ?? "";

  return {
    status: res.status,
    endpoint,
    sessionId,
    messages,
    waitFor: (match) =>
      new Promise<JsonRpcMessage>((resolve, reject) => {
        const already = messages.find(match);
        if (already) {
          resolve(already);
          return;
        }
        const timer = setTimeout(
          () => reject(new Error("timed out waiting for an SSE reply")),
          HARNESS_TIMEOUT_MS,
        );
        waiters.push({
          match,
          resolve: (m) => {
            clearTimeout(timer);
            resolve(m);
          },
        });
      }),
    close: () => abort.abort(),
  };
}

export async function postMessage({
  baseUrl,
  path,
  apiKey,
  body,
}: {
  baseUrl: string;
  path: string;
  apiKey?: string;
  body: unknown;
}): Promise<{ status: number; body: string }> {
  const headers: Record<string, string> = {
    "content-type": "application/json",
  };
  if (apiKey) headers.authorization = `Bearer ${apiKey}`;
  const res = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.text() };
}

export function initializeBody(id = 1) {
  return {
    jsonrpc: "2.0",
    id,
    method: "initialize",
    params: {
      protocolVersion: "2025-03-26",
      capabilities: {},
      clientInfo: { name: "relay-test-client", version: "1.0.0" },
    },
  };
}

/** Drives an SSE session through the MCP handshake over the given base URL. */
export async function handshake({
  stream,
  baseUrl,
  apiKey,
}: {
  stream: OpenSseStream;
  baseUrl: string;
  apiKey: string;
}): Promise<void> {
  const init = await postMessage({
    baseUrl,
    path: stream.endpoint,
    apiKey,
    body: initializeBody(1),
  });
  if (init.status !== 202) {
    throw new Error(
      `the handshake could not start: initialize answered ${init.status} ${init.body}`,
    );
  }
  await stream.waitFor((m) => m.id === 1);
  await postMessage({
    baseUrl,
    path: stream.endpoint,
    apiKey,
    body: { jsonrpc: "2.0", method: "notifications/initialized" },
  });
}
