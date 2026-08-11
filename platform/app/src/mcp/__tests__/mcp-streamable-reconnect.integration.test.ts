/**
 * @vitest-environment node
 *
 * Cross-replica behaviour of the MCP Streamable HTTP transport, against a real
 * Redis.
 *
 * A session is created on whichever replica answered the initialize, and the
 * client's next request is a fresh connection the load balancer may hand to
 * any of them. Rebuilding that session on the replica that receives it is what
 * makes a reconnect work; doing it only for the project that owns the session
 * is what keeps it safe.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { connection as redis } from "~/server/redis";
import {
  initializeBody,
  type ReplicaPair,
  startReplicaPair,
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

describe("Feature: MCP streamable transport across replicas", () => {
  let replicas: ReplicaPair;
  let urlA: string;
  let urlB: string;

  beforeAll(async () => {
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

          // A served stream never ends on its own, so the body is deliberately
          // left unread and torn down by the abort below. The refusal tests
          // that follow do read theirs, because a refusal is a finite body.
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
