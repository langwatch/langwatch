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
import { createServer, type Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { connection as redis } from "~/server/redis";
import { createMcpHandler, type McpHandler } from "../handler";
import {
  clearRecordedSessions,
  handshake,
  initializeBody,
  openSseStream,
  postMessage,
  SSE_SESSION_PREFIX,
  sseSessionSetKey,
} from "./support/sseHarness";

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

  const clearSessions = (apiKey: string) =>
    clearRecordedSessions({ redis: redis!, apiKey });

  beforeAll(async () => {
    if (!redis) {
      throw new Error(
        "These tests need a real Redis — set REDIS_URL / LANGWATCH_TEST_REDIS_URL",
      );
    }
    await clearSessions(VALID_API_KEY);
    await clearSessions(OTHER_API_KEY);

    handlerA = createMcpHandler();
    handlerB = createMcpHandler();
    [replicaA, urlA] = await listen(handlerA);
    [replicaB, urlB] = await listen(handlerB);
  });

  afterAll(async () => {
    await handlerA.closeAllSessions();
    await handlerB.closeAllSessions();
    await new Promise<void>((resolve) => replicaA.close(() => resolve()));
    await new Promise<void>((resolve) => replicaB.close(() => resolve()));
    await clearSessions(VALID_API_KEY);
    await clearSessions(OTHER_API_KEY);
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
        expect(JSON.parse(res.body).error).toContain("Session not found");
        // The stale record also stops counting against the project's limit.
        expect(await redis!.get(`${SSE_SESSION_PREFIX}${orphanId}`)).toBeNull();
      });
    });
  });

  describe("given a project already holds the maximum number of concurrent sessions", () => {
    describe("when a client opens another SSE connection", () => {
      /** @scenario SSE sessions count towards the per-project concurrent session limit */
      it("refuses the connection as over the session limit", async () => {
        const setKey = sseSessionSetKey(VALID_API_KEY);
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
    /** Opens a streamable session on replica A and returns its session id. */
    async function createStreamableSession(id: number): Promise<string> {
      const created = await fetch(`${urlA}/mcp`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "text/event-stream, application/json",
          authorization: `Bearer ${VALID_API_KEY}`,
        },
        body: JSON.stringify(initializeBody(id)),
      });
      // biome-ignore-start lint/suspicious/noMisplacedAssertion: the arrangement fails loudly here rather than as a confusing assertion later
      expect(created.status).toBe(200);
      const sessionId = created.headers.get("mcp-session-id");
      expect(sessionId).toBeTruthy();
      // biome-ignore-end lint/suspicious/noMisplacedAssertion: end of the arrangement checks
      await created.text();
      return sessionId!;
    }

    /**
     * Whether a replica built the session for itself. DELETE only consults
     * the replica's own session map, so it answers 200 exactly when that
     * replica holds the session and 404 when it never built one.
     */
    async function replicaHoldsSession(
      baseUrl: string,
      sessionId: string,
    ): Promise<boolean> {
      const res = await fetch(`${baseUrl}/mcp`, {
        method: "DELETE",
        headers: {
          authorization: `Bearer ${VALID_API_KEY}`,
          "mcp-session-id": sessionId,
        },
      });
      await res.text();
      return res.status === 200;
    }

    describe("when the client reconnects the stream through the other replica", () => {
      /** @scenario Reconnecting the streaming transport to another replica resumes the session */
      it("serves the stream instead of reporting the session expired", async () => {
        const sessionId = await createStreamableSession(71);

        const abort = new AbortController();
        try {
          const resumed = await fetch(`${urlB}/mcp`, {
            method: "GET",
            headers: {
              accept: "text/event-stream",
              authorization: `Bearer ${VALID_API_KEY}`,
              "mcp-session-id": sessionId,
            },
            signal: abort.signal,
          });

          expect(resumed.status).toBe(200);
        } finally {
          abort.abort();
        }
      });
    });

    describe("when the reconnect carries no credentials", () => {
      /** @scenario Reconnecting without credentials is refused and rebuilds nothing */
      it("answers 401 and leaves the other replica holding no session", async () => {
        const sessionId = await createStreamableSession(81);

        const abort = new AbortController();
        try {
          const resumed = await fetch(`${urlB}/mcp`, {
            method: "GET",
            headers: {
              accept: "text/event-stream",
              "mcp-session-id": sessionId,
            },
            signal: abort.signal,
          });
          await resumed.text();

          expect(resumed.status).toBe(401);
        } finally {
          abort.abort();
        }

        // Rebuilding decrypts the stored key and connects a server bound to
        // it, so a refused caller must not have caused any of it.
        expect(await replicaHoldsSession(urlB, sessionId)).toBe(false);
      });
    });

    describe("when the reconnect carries credentials for a different project", () => {
      /** @scenario Reconnecting with another project's credentials is refused and rebuilds nothing */
      it("answers 401 and leaves the other replica holding no session", async () => {
        const sessionId = await createStreamableSession(91);

        const abort = new AbortController();
        try {
          const resumed = await fetch(`${urlB}/mcp`, {
            method: "GET",
            headers: {
              accept: "text/event-stream",
              authorization: `Bearer ${OTHER_API_KEY}`,
              "mcp-session-id": sessionId,
            },
            signal: abort.signal,
          });
          await resumed.text();

          expect(resumed.status).toBe(401);
        } finally {
          abort.abort();
        }

        expect(await replicaHoldsSession(urlB, sessionId)).toBe(false);
      });
    });
  });
});
