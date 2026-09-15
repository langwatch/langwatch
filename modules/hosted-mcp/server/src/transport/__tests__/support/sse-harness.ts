/**
 * A minimal MCP SSE client for tests: it opens the stream, keeps consuming it,
 * and posts messages back over the endpoint the stream names. Apart from the
 * scenarios so those read as behaviour rather than as transport plumbing.
 */
import { createHash } from "node:crypto";
import { createServer, type Server } from "node:http";
import type { IncomingMessage } from "node:http";
import { Redis } from "ioredis";
import {
  createMcpHandler,
  McpApiKeyCipher,
  McpClientAddress,
  McpProjectLookup,
  McpSessionGrant,
  type HostedMcpRedis,
  type McpHandler,
} from "../../../index.ts";

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

interface SseWaiter {
  match: (m: JsonRpcMessage) => boolean;
  resolve: (m: JsonRpcMessage) => void;
}

/** Settles, and drops, every waiter whose match predicate the newly parsed message satisfies. */
function resolveMatchingWaiters(waiters: SseWaiter[], parsed: JsonRpcMessage): void {
  for (let i = waiters.length - 1; i >= 0; i--) {
    const waiter = waiters[i]!;
    if (waiter.match(parsed)) {
      waiters.splice(i, 1);
      waiter.resolve(parsed);
    }
  }
}

/**
 * The Redis these suites talk to. Opened by the suite, so the suite closes it.
 * Native Redis is the local default; CI hands the URL in.
 */
export function connectTestRedis(): HostedMcpRedis {
  const url =
    process.env.LANGWATCH_TEST_REDIS_URL ?? process.env.REDIS_URL ?? "redis://localhost:6379";
  return new Redis(url, { maxRetriesPerRequest: null });
}

/** The project every key in `apiKeys` belongs to, keyed by the key itself. */
class HarnessProjectLookup extends McpProjectLookup {
  constructor(private readonly apiKeys: readonly string[]) {
    super();
  }
  tryFindLiveProjectByApiKey({
    apiKey,
  }: {
    apiKey: string;
  }): Promise<{ id: string; teamId: string } | null> {
    return Promise.resolve(
      this.apiKeys.includes(apiKey) ? { id: `project-for-${apiKey}`, teamId: "team-1" } : null,
    );
  }
}

/** Every grant holds: these suites are about transport, not about revocation. */
class HarnessSessionGrant extends McpSessionGrant {
  stillGranted(): Promise<boolean> {
    return Promise.resolve(true);
  }
}

/** Identity "encryption", so a suite can read the value it expected to be stored. */
class HarnessCipher extends McpApiKeyCipher {
  encrypt(text: string): string {
    return `encrypted:${text}`;
  }
  decrypt(text: string): string {
    return text.startsWith("encrypted:") ? text.slice(10) : text;
  }
}

/** Every replica answers on loopback, so every caller is the same address. */
class HarnessClientAddress extends McpClientAddress {
  clientIp(request: IncomingMessage): string {
    return request.socket.remoteAddress ?? "127.0.0.1";
  }
}

/**
 * Names the Redis set that holds one project's session ids for a transport.
 * The digest namespaces a bucket of session ids rather than protecting the
 * key, and the production side derives it the same way.
 */
function sessionSetKey({ setPrefix, apiKey }: { setPrefix: string; apiKey: string }): string {
  const digest = createHash("sha256").update(apiKey).digest("hex").slice(0, 16);
  return `${setPrefix}${digest}`;
}

/**
 * Drops every session record a key owns, for both transports. Records outlive
 * the process that wrote them, so a suite that leaves them behind spends the
 * project's concurrent-session budget on its own debris.
 */
export async function clearRecordedSessions({
  redis,
  apiKey,
}: {
  redis: HostedMcpRedis;
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

export interface ReplicaPair {
  urlA: string;
  urlB: string;
  stop: () => Promise<void>;
}

/**
 * Two handlers, each on its own server, sharing one Redis — the shape of
 * production: replicas behind a load balancer with no session affinity, each
 * with its own session map and relay subscriber, only Redis in common.
 */
export async function startReplicaPair({
  redis,
  apiKeys,
}: {
  redis: HostedMcpRedis;
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
      const handler = createMcpHandler({
        redis,
        projects: new HarnessProjectLookup(apiKeys),
        grants: new HarnessSessionGrant(),
        cipher: new HarnessCipher(),
        address: new HarnessClientAddress(),
        baseHost: "https://app.langwatch.ai",
      });
      const server = createServer((req, res) => handler.handleRequest(req, res));
      await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
      const address = server.address();
      if (typeof address !== "object" || !address) {
        throw new Error("a replica reported no address after listening");
      }
      handlers.push(handler);
      servers.push(server);
      urls.push(`http://127.0.0.1:${address.port}`);
    }
  } catch (err) {
    for (const server of servers) {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
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
      `GET /sse answered ${res.status}, no stream to read: ${await res.text().catch(() => "")}`,
    );
  }

  const messages: JsonRpcMessage[] = [];
  const waiters: SseWaiter[] = [];
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
          const event = /^event:\s*(.*)$/m.exec(frame)?.[1]?.trim() ?? "message";
          if (event === "endpoint") {
            resolveEndpoint(data);
            continue;
          }
          try {
            const parsed = JSON.parse(data) as JsonRpcMessage;
            messages.push(parsed);
            resolveMatchingWaiters(waiters, parsed);
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
    rejectAfter(HARNESS_TIMEOUT_MS, "the stream opened but never named its message endpoint"),
  ]).catch((err: unknown) => {
    abort.abort();
    throw err;
  });
  const sessionId = new URL(endpoint, "http://localhost").searchParams.get("sessionId") ?? "";

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
  const headers: Record<string, string> = { "content-type": "application/json" };
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
