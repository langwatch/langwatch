/**
 * @vitest-environment node
 *
 * Cross-replica behaviour of the MCP SSE transport, against a real Redis.
 *
 * Production runs several app replicas behind a load balancer with no session
 * affinity. `GET /sse` opens a stream that only lives on the replica that
 * answered it, while every follow-up `POST /messages?sessionId=…` is a fresh
 * connection the balancer may hand to any replica. Two handler instances in
 * one process, sharing one Redis, reproduce that exactly: each has its own
 * session map and its own relay subscriber, and only Redis is common.
 */
import { createHash } from "node:crypto";
import { createServer, type Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { connection as redis } from "~/server/redis";
import { createMcpHandler, type McpHandler } from "../handler";

const VALID_API_KEY = "lw_relay_key_a";
const OTHER_API_KEY = "lw_relay_key_b";

const { mockPrisma } = vi.hoisted(() => ({
  mockPrisma: {
    project: {
      findUnique: vi.fn(({ where }: { where: { apiKey: string } }) =>
        Promise.resolve(
          where.apiKey === "lw_relay_key_a" || where.apiKey === "lw_relay_key_b"
            ? {
                id: `project-for-${where.apiKey}`,
                apiKey: where.apiKey,
                teamId: "team-1",
                name: "Test Project",
                archivedAt: null,
              }
            : null,
        ),
      ),
    },
  },
}));

vi.mock("~/server/db", () => ({ prisma: mockPrisma }));

// Identity encryption so the test can write session records Redis-side and
// read back what the handler stored without holding a key.
vi.mock("~/utils/encryption", () => ({
  encrypt: (text: string) => `encrypted:${text}`,
  decrypt: (text: string) =>
    text.startsWith("encrypted:") ? text.slice(10) : text,
}));

const SSE_SESSION_PREFIX = "mcp:sse:session:";
const SSE_SESSION_SET_PREFIX = "mcp:sse:sessions_by_key:";

interface JsonRpcMessage {
  id?: number | string;
  result?: Record<string, unknown>;
  error?: Record<string, unknown>;
  method?: string;
}

interface OpenSseStream {
  status: number;
  endpoint: string;
  sessionId: string;
  messages: JsonRpcMessage[];
  waitFor: (match: (m: JsonRpcMessage) => boolean) => Promise<JsonRpcMessage>;
  close: () => void;
}

/**
 * Opens `GET /sse` and keeps consuming the stream in the background, so the
 * test can assert on replies that arrive after the POST that triggered them
 * has already been answered.
 */
async function openSseStream({
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

  const messages: JsonRpcMessage[] = [];
  const waiters: {
    match: (m: JsonRpcMessage) => boolean;
    resolve: (m: JsonRpcMessage) => void;
  }[] = [];
  let resolveEndpoint!: (path: string) => void;
  const endpointArrived = new Promise<string>((resolve) => {
    resolveEndpoint = resolve;
  });

  const reader = res.body!.getReader();
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

  const endpoint = await endpointArrived;
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
          20_000,
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

async function postMessage({
  baseUrl,
  path,
  apiKey,
  body,
}: {
  baseUrl: string;
  path: string;
  apiKey?: string;
  body: unknown;
}) {
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

function initializeBody(id = 1) {
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
async function handshake({
  stream,
  baseUrl,
  apiKey,
}: {
  stream: OpenSseStream;
  baseUrl: string;
  apiKey: string;
}) {
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

describe("Feature: MCP SSE transport across replicas", () => {
  let replicaA: Server;
  let replicaB: Server;
  let handlerA: McpHandler;
  let handlerB: McpHandler;
  let urlA: string;
  let urlB: string;

  async function listen(handler: McpHandler): Promise<[Server, string]> {
    const server = createServer((req, res) => handler.handleRequest(req, res));
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const address = server.address();
    const port = typeof address === "object" && address ? address.port : 0;
    return [server, `http://127.0.0.1:${port}`];
  }

  beforeAll(async () => {
    if (!redis) {
      throw new Error(
        "These tests need a real Redis — set REDIS_URL / LANGWATCH_TEST_REDIS_URL",
      );
    }

    handlerA = createMcpHandler();
    handlerB = createMcpHandler();
    [replicaA, urlA] = await listen(handlerA);
    [replicaB, urlB] = await listen(handlerB);
  });

  afterAll(async () => {
    handlerA.closeAllSessions();
    handlerB.closeAllSessions();
    await new Promise<void>((resolve) => replicaA.close(() => resolve()));
    await new Promise<void>((resolve) => replicaB.close(() => resolve()));
  });

  describe("given a client opened an SSE connection against one replica", () => {
    describe("when it posts a message to the other replica", () => {
      /** @scenario A message posted to a replica that does not hold the stream still reaches the session */
      it("relays the message to the replica holding the stream and answers on that stream", async () => {
        const stream = await openSseStream({
          baseUrl: urlA,
          apiKey: VALID_API_KEY,
        });
        try {
          expect(stream.status).toBe(200);
          expect(stream.sessionId).not.toBe("");

          // Every message goes to replica B, which never saw the stream open.
          await handshake({ stream, baseUrl: urlB, apiKey: VALID_API_KEY });

          const listed = await postMessage({
            baseUrl: urlB,
            path: stream.endpoint,
            apiKey: VALID_API_KEY,
            body: { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} },
          });
          expect(listed.status).toBe(202);

          const reply = await stream.waitFor((m) => m.id === 2);
          const tools = (reply.result?.tools ?? []) as unknown[];
          expect(reply.error).toBeUndefined();
          expect(tools.length).toBeGreaterThan(0);
        } finally {
          stream.close();
        }
      });

      /** @scenario Clients that append the message path to the connect path are still routed */
      it("routes a message posted to the /sse/messages alias", async () => {
        const stream = await openSseStream({
          baseUrl: urlA,
          apiKey: VALID_API_KEY,
        });
        try {
          const aliased = `/sse${stream.endpoint}`;
          const res = await postMessage({
            baseUrl: urlB,
            path: aliased,
            apiKey: VALID_API_KEY,
            body: initializeBody(11),
          });

          expect(res.status).toBe(202);
          await stream.waitFor((m) => m.id === 11);
        } finally {
          stream.close();
        }
      });
    });

    describe("when it posts a message to the replica that holds the stream", () => {
      /** @scenario A message posted to the replica holding the stream is answered directly */
      it("answers it locally without going through the relay", async () => {
        const stream = await openSseStream({
          baseUrl: urlA,
          apiKey: VALID_API_KEY,
        });
        try {
          const res = await postMessage({
            baseUrl: urlA,
            path: stream.endpoint,
            apiKey: VALID_API_KEY,
            body: initializeBody(21),
          });

          expect(res.status).toBe(202);
          const reply = await stream.waitFor((m) => m.id === 21);
          expect(reply.error).toBeUndefined();
        } finally {
          stream.close();
        }
      });
    });

    describe("when a message presents credentials for a different project", () => {
      /** @scenario A message carrying credentials for a different project is rejected */
      it("rejects it as unauthorized and never delivers it", async () => {
        const stream = await openSseStream({
          baseUrl: urlA,
          apiKey: VALID_API_KEY,
        });
        try {
          const res = await postMessage({
            baseUrl: urlB,
            path: stream.endpoint,
            apiKey: OTHER_API_KEY,
            body: initializeBody(31),
          });

          expect(res.status).toBe(401);
          expect(stream.messages.some((m) => m.id === 31)).toBe(false);
        } finally {
          stream.close();
        }
      });
    });

    describe("when a message carries no credentials at all", () => {
      /** @scenario A message with no credentials is rejected as unauthorized rather than as a bad session */
      it("answers 401 rather than reporting a bad session", async () => {
        const stream = await openSseStream({
          baseUrl: urlA,
          apiKey: VALID_API_KEY,
        });
        try {
          const res = await postMessage({
            baseUrl: urlB,
            path: stream.endpoint,
            body: initializeBody(41),
          });

          expect(res.status).toBe(401);
        } finally {
          stream.close();
        }
      });
    });
  });

  describe("given no session exists for the presented session id", () => {
    describe("when a client posts a message for it", () => {
      /** @scenario A message for an unknown session is rejected as a missing session */
      it("answers 404 so the client reconnects", async () => {
        const res = await postMessage({
          baseUrl: urlB,
          path: "/messages?sessionId=relay-session-that-never-existed",
          apiKey: VALID_API_KEY,
          body: initializeBody(51),
        });

        expect(res.status).toBe(404);
        expect(JSON.parse(res.body).error).toContain("Session not found");
      });
    });
  });

  describe("given a session was recorded but the replica holding its stream is gone", () => {
    describe("when a client posts a message for it", () => {
      /** @scenario A message for a session whose replica is gone tells the client to reconnect */
      it("answers 404 and forgets the recorded session", async () => {
        const orphanId = "relay-orphan-session";
        await redis!.set(
          `${SSE_SESSION_PREFIX}${orphanId}`,
          JSON.stringify({
            encryptedApiKey: `encrypted:${VALID_API_KEY}`,
            createdAt: Date.now(),
          }),
          "EX",
          600,
        );

        const res = await postMessage({
          baseUrl: urlB,
          path: `/messages?sessionId=${orphanId}`,
          apiKey: VALID_API_KEY,
          body: initializeBody(61),
        });

        expect(res.status).toBe(404);
        expect(await redis!.get(`${SSE_SESSION_PREFIX}${orphanId}`)).toBeNull();
      });
    });
  });

  describe("given a project already holds the maximum number of concurrent sessions", () => {
    describe("when a client opens another SSE connection", () => {
      /** @scenario SSE sessions count towards the per-project concurrent session limit */
      it("refuses the connection as over the session limit", async () => {
        const keyHash = createHash("sha256")
          .update(VALID_API_KEY)
          .digest("hex")
          .slice(0, 16);
        const setKey = `${SSE_SESSION_SET_PREFIX}${keyHash}`;
        const seeded: string[] = [];
        for (let i = 0; i < 20; i++) {
          const id = `relay-seeded-${i}`;
          seeded.push(id);
          await redis!.set(
            `${SSE_SESSION_PREFIX}${id}`,
            JSON.stringify({
              encryptedApiKey: `encrypted:${VALID_API_KEY}`,
              createdAt: Date.now(),
            }),
            "EX",
            600,
          );
          await redis!.sadd(setKey, id);
        }

        try {
          const res = await fetch(`${urlA}/sse`, {
            method: "GET",
            headers: { authorization: `Bearer ${VALID_API_KEY}` },
          });
          const text = await res.text();

          expect(res.status).toBe(429);
          expect(text).toContain("Too many concurrent sessions");
        } finally {
          for (const id of seeded) {
            await redis!.del(`${SSE_SESSION_PREFIX}${id}`);
          }
          await redis!.del(setKey);
        }
      });
    });
  });

  describe("given a streamable session was created on one replica", () => {
    describe("when the client reconnects the stream through the other replica", () => {
      /** @scenario Reconnecting the streaming transport to another replica resumes the session */
      it("serves the stream instead of reporting the session expired", async () => {
        const created = await fetch(`${urlA}/mcp`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            accept: "text/event-stream, application/json",
            authorization: `Bearer ${VALID_API_KEY}`,
          },
          body: JSON.stringify(initializeBody(71)),
        });
        expect(created.status).toBe(200);
        const sessionId = created.headers.get("mcp-session-id");
        expect(sessionId).toBeTruthy();
        await created.text();

        const abort = new AbortController();
        try {
          const resumed = await fetch(`${urlB}/mcp`, {
            method: "GET",
            headers: {
              accept: "text/event-stream",
              authorization: `Bearer ${VALID_API_KEY}`,
              "mcp-session-id": sessionId!,
            },
            signal: abort.signal,
          });

          expect(resumed.status).toBe(200);
        } finally {
          abort.abort();
        }
      });
    });
  });
});
