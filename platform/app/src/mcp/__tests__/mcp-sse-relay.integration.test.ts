/**
 * @vitest-environment node
 *
 * Cross-replica behaviour of the MCP SSE transport, against a real Redis.
 *
 * Production runs several app replicas behind a load balancer with no session
 * affinity. `GET /sse` opens a stream that only lives on the replica that
 * answered it, while every follow-up `POST /messages?sessionId=…` is a fresh
 * connection the balancer may hand to any replica.
 */
import { type RedisConnection, RedisConnectionService } from "@langwatch/redis-client";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  handshake,
  initializeBody,
  openSseStream,
  postMessage,
  type ReplicaPair,
  SSE_SESSION_PREFIX,
  sseSessionSetKey,
  startReplicaPair,
} from "./support/sseHarness";

const VALID_API_KEY = "lw_relay_key_a";
const OTHER_API_KEY = "lw_relay_key_b";

/** Opened in `beforeAll`, so the arrange steps below reach it through here. */
let redis: RedisConnection | null = null;

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
  decrypt: (text: string) => (text.startsWith("encrypted:") ? text.slice(10) : text),
}));

describe("Feature: MCP SSE transport across replicas", () => {
  let replicas: ReplicaPair;
  let urlA: string;
  let urlB: string;

  beforeAll(async () => {
    // This suite boots no App of its own, so it owns the connection it opens
    // and closes it below (ADR-093). The harness lends it to the replicas.
    redis = new RedisConnectionService().connect({
      url: process.env.REDIS_URL,
      clusterEndpoints: process.env.REDIS_CLUSTER_ENDPOINTS,
      dbIndex: process.env.REDIS_DB_INDEX,
    });
    if (!redis) {
      throw new Error(
        "These tests need a real Redis — set REDIS_URL / LANGWATCH_TEST_REDIS_URL",
      );
    }
    replicas = await startReplicaPair({
      redis,
      apiKeys: [VALID_API_KEY, OTHER_API_KEY],
    });
    ({ urlA, urlB } = replicas);
  });

  afterAll(async () => {
    // beforeAll throws when Redis is missing, which leaves this unset;
    // dereferencing it here would replace that message with a TypeError.
    await replicas?.stop();
    redis?.disconnect();
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
});
