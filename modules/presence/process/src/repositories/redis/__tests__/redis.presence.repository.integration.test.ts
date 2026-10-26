/**
 * @vitest-environment node
 * The Redis presence repository lists a project's sessions from its per-project index,
 * never by scanning the keyspace.
 * Spec: modules/presence/specs/presence.feature
 */
import { randomUUID } from "node:crypto";

import type { PresenceSession } from "@langwatch/presence-contract";
import Redis from "ioredis";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { RedisPresenceRepository } from "../redis.presence.repository.ts";

const redisUrl = process.env.LANGWATCH_TEST_REDIS_URL;
const TTL_SECONDS = 30;
const START = 1_800_000_000_000;

const sessionKey = (projectId: string, sessionId: string) =>
  `presence:v1:{${projectId}}:${sessionId}`;
const indexKey = (projectId: string) => `presence:v1:index:{${projectId}}`;
/** Redis's rule: the text between the first `{` and the next `}`, when that text is not empty. */
function hashTagOf(key: string): string | undefined {
  const open = key.indexOf("{");
  const close = open === -1 ? -1 : key.indexOf("}", open + 1);
  return close > open + 1 ? key.slice(open + 1, close) : undefined;
}

function sessionFor({
  projectId,
  sessionId,
  updatedAt = START,
}: {
  projectId: string;
  sessionId: string;
  updatedAt?: number;
}): PresenceSession {
  return {
    sessionId,
    projectId,
    user: { id: `user-${sessionId}`, name: "Test User", image: null },
    location: { lens: "traces", route: {} },
    updatedAt,
  };
}

describe.skipIf(!redisUrl)("given the Redis presence repository", () => {
  let redis: Redis;
  let clock: number;
  let repository: RedisPresenceRepository;

  beforeAll(() => {
    if (!redisUrl) throw new Error("LANGWATCH_TEST_REDIS_URL is required here");
    redis = new Redis(redisUrl);
    repository = RedisPresenceRepository.create(redis, { now: () => clock });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  afterAll(() => {
    redis.disconnect();
  });

  describe("when sessions heartbeat in two projects", () => {
    /** @scenario "Listing a project's sessions never scans the keyspace" */
    it("lists only that project's sessions, once each, without scanning", async () => {
      clock = START;
      const projectId = `project-${randomUUID()}`;
      const otherProjectId = `project-${randomUUID()}`;
      await repository.upsert(sessionFor({ projectId, sessionId: "a" }), TTL_SECONDS);
      await repository.upsert(
        sessionFor({ projectId, sessionId: "a", updatedAt: START + 1 }),
        TTL_SECONDS,
      );
      await repository.upsert(sessionFor({ projectId, sessionId: "b" }), TTL_SECONDS);
      await repository.upsert(
        sessionFor({ projectId: otherProjectId, sessionId: "theirs" }),
        TTL_SECONDS,
      );
      const scan = vi.spyOn(redis, "scan");

      const sessions = await repository.findByProject(projectId);

      expect(sessions.map((s) => s.sessionId).toSorted()).toEqual(["a", "b"]);
      expect(sessions.find((s) => s.sessionId === "a")?.updatedAt).toBe(START + 1);
      expect(scan).not.toHaveBeenCalled();
    });
  });

  describe("when one session left and another stopped heartbeating", () => {
    /** @scenario "A session that left or stopped heartbeating is not listed" */
    it("lists neither, and the index expires with its last session", async () => {
      // The clock stays put: only Redis's own expiry can drop the stale session.
      clock = START;
      const projectId = `project-${randomUUID()}`;
      const soloProjectId = `project-${randomUUID()}`;
      await repository.upsert(sessionFor({ projectId, sessionId: "left" }), TTL_SECONDS);
      await repository.upsert(sessionFor({ projectId, sessionId: "stale" }), 1);
      await repository.upsert(sessionFor({ projectId, sessionId: "live" }), TTL_SECONDS);
      await repository.upsert(sessionFor({ projectId: soloProjectId, sessionId: "solo" }), 1);

      const removed = await repository.remove({ projectId, sessionId: "left" });
      await vi.waitFor(
        async () => {
          expect(await redis.exists(sessionKey(projectId, "stale"))).toBe(0);
          expect(await redis.exists(sessionKey(soloProjectId, "solo"))).toBe(0);
          expect(await redis.exists(indexKey(soloProjectId))).toBe(0);
        },
        { timeout: 3_000, interval: 100 },
      );
      const sessions = await repository.findByProject(projectId);

      expect(removed).toBe(true);
      expect(sessions.map((s) => s.sessionId)).toEqual(["live"]);
    });
  });

  describe("when a session heartbeats", () => {
    /** @scenario "A project's sessions and its index share one cluster slot" */
    it("writes only keys carrying the project's hash tag", async () => {
      clock = START;
      const projectId = `project-${randomUUID()}`;

      await repository.upsert(sessionFor({ projectId, sessionId: "a" }), TTL_SECONDS);
      const written: string[] = [];
      let cursor = "0";
      do {
        const [next, keys] = await redis.scan(cursor, "MATCH", `*${projectId}*`);
        written.push(...keys);
        cursor = next;
      } while (cursor !== "0");

      expect(written).toHaveLength(2);
      expect(written.map(hashTagOf)).toEqual([projectId, projectId]);
    });
  });
});
