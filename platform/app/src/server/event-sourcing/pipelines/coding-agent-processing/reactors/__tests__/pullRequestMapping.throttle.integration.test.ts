/**
 * @vitest-environment node
 *
 * The mapping throttle under the workload the feature exists for: several agent
 * worktrees running against ONE branch at the same time.
 *
 * These drive the real staging Lua (`GroupStagingScripts.stage`) against real
 * Redis, because the defect is inside it. The dedup key is queue-global, but the
 * squash it guards is conditional on `ZRANK(group:<groupId>:jobs, existingJobId)`
 * — the rank of the existing job in the NEW payload's OWN group. Two sessions
 * on one branch share a dedup id and, with the reactor's default per-aggregate
 * grouping, land in two different groups: the rank lookup misses, the script
 * reads that as "already dispatched", and (with `shouldSurviveDispatch` off)
 * DELETES the dedup key and stages a second job. Both call GitHub, and the key
 * that was protecting the first is gone.
 *
 * @see specs/coding-agent/pull-request-linkage.feature
 */
import type { Redis } from "ioredis";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  startTestContainers,
  stopTestContainers,
} from "../../../../__tests__/integration/testContainers";
import { GroupStagingScripts } from "../../../../queues/groupQueue/scripts";
import type { CodingAgentSessionState } from "../../projections/codingAgentSession.foldProjection";
import type { CodingAgentProcessingEvent } from "../../schemas/events";
import { createPullRequestMappingReactor } from "../pullRequestMapping.reactor";

const QUEUE_NAME = "{test/prmap-throttle}";
const TENANT_ID = "project-throttle";

let redis: Redis;
let scripts: GroupStagingScripts;

function keyPrefix() {
  return `${QUEUE_NAME}:gq:`;
}

/** One session's fold, on the shared branch. */
function payloadFor(sessionId: string) {
  return {
    event: {
      tenantId: TENANT_ID,
      aggregateId: sessionId,
      aggregateType: "coding_agent_session",
      createdAt: Date.now(),
    } as unknown as CodingAgentProcessingEvent,
    foldState: {
      repositoryHost: "github.com",
      repositoryOwner: "acme",
      repositoryName: "widgets",
      gitBranch: "feat/shared",
    } as unknown as CodingAgentSessionState,
  };
}

const reactor = createPullRequestMappingReactor({
  requestBranchMapping: async () => undefined,
});

/**
 * The group id `QueueManager.initializeReactorQueues` builds for a reactor
 * payload, transcribed: `${tenantId}/${jobPath}/${domainKey}`, where the domain
 * key is the reactor's own `groupKeyFn` when it declares one and
 * `${aggregateType}:${aggregateId}` otherwise. Transcribed rather than imported
 * because `buildGroupKey` is private; the companion unit test pins the
 * reactor's half of it.
 */
function groupIdFor(payload: ReturnType<typeof payloadFor>): string {
  const jobPath = "fold/codingAgentSession/reactor/pullRequestMapping";
  const domainKey =
    reactor.options?.groupKeyFn?.(payload as never) ??
    `${payload.event.aggregateType}:${String(payload.event.aggregateId)}`;
  return `${payload.event.tenantId}/${jobPath}/${domainKey}`;
}

/** Stage one fold's mapping job exactly as the reactor lane would. */
async function stageMappingJob(
  payload: ReturnType<typeof payloadFor>,
  stagedJobId: string,
) {
  const dedup = reactor.options?.deduplication;
  if (!dedup) throw new Error("reactor declares no deduplication");
  const groupId = groupIdFor(payload);
  return await scripts.stage({
    stagedJobId,
    groupId,
    dispatchAfterMs: payload.event.createdAt + (reactor.options?.delay ?? 0),
    dedupId: dedup.makeId(payload as never),
    dedupTtlMs: dedup.ttlMs ?? 0,
    jobDataJson: JSON.stringify({ stagedJobId }),
    shouldExtend: dedup.extend ?? true,
    shouldReplace: dedup.replace ?? true,
    shouldSurviveDispatch: dedup.shouldSurviveDispatch ?? false,
  });
}

async function pendingJobCount(): Promise<number> {
  const keys = await redis.keys(`${keyPrefix()}group:*:jobs`);
  let total = 0;
  for (const key of keys) {
    total += await redis.zcard(key);
  }
  return total;
}

describe("pull-request mapping throttle", () => {
  beforeAll(async () => {
    const containers = await startTestContainers();
    redis = containers.redisConnection;
    scripts = new GroupStagingScripts(redis, QUEUE_NAME);
  }, 120_000);

  afterAll(async () => {
    const keys = await redis.keys(`${keyPrefix()}*`);
    if (keys.length > 0) await redis.del(...keys);
    await stopTestContainers();
  });

  beforeEach(async () => {
    const keys = await redis.keys(`${keyPrefix()}*`);
    if (keys.length > 0) await redis.del(...keys);
  });

  describe("given two concurrent sessions folding on the same branch", () => {
    /** @scenario "Concurrent sessions on one branch ask GitHub once" */
    it("stages one mapping job, not one per session", async () => {
      const first = payloadFor("session-a");
      const second = payloadFor("session-b");

      const dedup = reactor.options!.deduplication!;
      // The premise: the two folds agree on the job's identity. If they did
      // not, nothing below would be about the throttle at all.
      expect(dedup.makeId(second as never)).toBe(dedup.makeId(first as never));

      const staged = [
        await stageMappingJob(first, "job-a"),
        await stageMappingJob(second, "job-b"),
      ];

      expect(staged.map((result) => result.isNew)).toEqual([true, false]);
      expect(await pendingJobCount()).toBe(1);
    });

    it("keeps the dedup key pointing at the surviving job", async () => {
      const first = payloadFor("session-a");
      const second = payloadFor("session-b");
      const dedupId = reactor.options!.deduplication!.makeId(first as never);

      await stageMappingJob(first, "job-a");
      await stageMappingJob(second, "job-b");

      expect(await redis.get(`${keyPrefix()}dedup:${dedupId}`)).toBe("job-a");
    });
  });

  describe("given a session whose fold events are already backlogged", () => {
    /**
     * The reactor's ready score is the event's own `createdAt`, so a job's
     * dispatch deadline is `createdAt + delay`. For a group draining an hour-old
     * backlog that deadline is already in the past: the job is immediately
     * dispatchable, and the window that was supposed to collapse the burst has
     * no time left to collapse anything. What still holds the throttle is the
     * dedup TTL surviving dispatch.
     *
     * @scenario "Concurrent sessions on one branch ask GitHub once"
     */
    it("still collapses a burst whose window has already elapsed", async () => {
      const stale = Date.now() - 60 * 60 * 1000;
      const first = payloadFor("session-a");
      const second = payloadFor("session-b");
      first.event = { ...first.event, createdAt: stale } as never;
      second.event = { ...second.event, createdAt: stale } as never;

      await stageMappingJob(first, "job-a");
      // Simulate the dispatch the elapsed deadline makes immediate: the job
      // leaves staging while its dedup key is still alive.
      await redis.zrem(
        `${keyPrefix()}group:${groupIdFor(first)}:jobs`,
        "job-a",
      );

      const secondResult = await stageMappingJob(second, "job-b");

      expect(secondResult.isNew).toBe(false);
      expect(await pendingJobCount()).toBe(0);
    });
  });

  describe("given two sessions on DIFFERENT branches of one repository", () => {
    it("keeps them apart, so a second branch is never throttled by the first", async () => {
      const first = payloadFor("session-a");
      const second = payloadFor("session-b");
      second.foldState = {
        ...second.foldState,
        gitBranch: "feat/other",
      } as never;

      await stageMappingJob(first, "job-a");
      const result = await stageMappingJob(second, "job-b");

      expect(result.isNew).toBe(true);
      expect(await pendingJobCount()).toBe(2);
    });
  });
});
