import type { Redis } from "ioredis";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  startTestContainers,
  stopTestContainers,
} from "../../../../event-sourcing/__tests__/integration/testContainers";
import { GroupStagingScripts } from "../../../../event-sourcing/queues/groupQueue/scripts";
import { QueueRedisRepository } from "../../repositories/queue.redis.repository";

let redis: Redis;
beforeAll(async () => {
  ({ redisConnection: redis } = await startTestContainers());
});
afterAll(async () => {
  await stopTestContainers();
});

// Module-level incrementing counter for unique queue names — no Date.now().
let queueCounter = 0;

/**
 * Hand the repository a client whose set-scan is rigged to walk `pages` in
 * order, cycling so every fresh scan sees the whole sequence. Everything else
 * goes to the real Redis, so the sweep script, the pipelines and the expiry
 * semantics are all still real — only the paging is chosen.
 *
 * SSCAN promises only that a member present for the whole scan comes back AT
 * LEAST once, and a set resized mid-scan really does repeat members across
 * pages. Nothing makes a live Redis do it on demand, so it is rigged here
 * rather than left untested.
 */
function withRiggedSetScan(
  real: Redis,
  pages: Array<[cursor: string, members: string[]]>,
): Redis {
  let next = 0;
  return new Proxy(real, {
    get(target, prop) {
      if (prop === "sscan") {
        return async () => pages[next++ % pages.length]!;
      }
      const value: unknown = Reflect.get(target, prop);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

let repo: QueueRedisRepository;
let queueName: string;
let prefix: string;
let scripts: GroupStagingScripts;
const groupId = "project-1/reactor/customEvaluationSync/aggregate-1";
const stagedJobId = "evt-1/staged";

const indexKey = () => `${prefix}dlq`;
const dlqJobsKey = () => `${prefix}dlq:${groupId}:jobs`;
const dlqDataKey = () => `${prefix}dlq:${groupId}:data`;
const dlqErrorKey = () => `${prefix}dlq:${groupId}:error`;

beforeEach(() => {
  repo = new QueueRedisRepository(redis);
  queueCounter++;
  queueName = `{test/dlq-heal-${queueCounter}}`;
  prefix = `${queueName}:gq:`;
  scripts = new GroupStagingScripts(redis, queueName);
});

/**
 * The #719 path under review: one body-present staged job preserved in the
 * job-scoped dead-letter, through the production writer.
 */
async function deadLetterOneBodyPresentJob(): Promise<void> {
  await scripts.writeJobToDlq({
    groupId,
    stagedJobId,
    jobDataJson: JSON.stringify({ payload: { id: "evt-1" } }),
    reason: "decode_failed",
    nowMs: 1_700_000_000_000,
  });
}

/**
 * A stale block dead-lettered by the operator's group-scoped action: blocked
 * with a recorded error but nothing pending (`isStaleBlock`), so MOVE_TO_DLQ
 * carries the error hash over and never creates a jobs zset. This is the state
 * that makes "no recoverable jobs" the wrong test for whether a dead-letter is
 * still worth showing.
 */
async function deadLetterAStaleBlock(): Promise<void> {
  await redis.hset(`${prefix}group:${groupId}:error`, {
    message: "handler timed out",
    stack: "at reactorHandler",
    timestamp: String(1_700_000_000_000),
  });
  await redis.sadd(`${prefix}blocked`, groupId);
  await repo.moveToDlq({ queueName, groupId });
}

/**
 * End the quarantine window the way production ends it — by letting the
 * deadline pass. PEXPIREAT with a time already gone drops the key immediately,
 * so this is the real expiry the 7-day TTL performs, not a DEL standing in for
 * it, and it leaves exactly the state at issue: payload gone, member behind.
 */
async function letTheQuarantineWindowExpire(): Promise<void> {
  const alreadyPast = Date.now() - 1000;
  await Promise.all([
    redis.pexpireat(dlqJobsKey(), alreadyPast),
    redis.pexpireat(dlqDataKey(), alreadyPast),
    redis.pexpireat(dlqErrorKey(), alreadyPast),
  ]);
}

/** Keys Redis still holds for this dead-letter (0 = the payload is gone). */
async function survivingPayloadKeys(): Promise<number> {
  return redis.exists(dlqJobsKey(), dlqDataKey(), dlqErrorKey());
}

/** Whether the queue still names this group as dead-lettered at all. */
async function stillTracked(): Promise<number> {
  return redis.sismember(indexKey(), groupId);
}

/** The figure behind the ops nav badge and the dashboard DLQ tile. */
async function dlqCount(): Promise<number> {
  const [queue] = await repo.scanQueues({ queueNames: [queueName] });
  return queue!.dlqCount;
}

/**
 * The dead-letter's own accounting, once dead-lettering is automatic.
 *
 * A group is named in the DLQ index by SADD, and a Redis set has no per-member
 * TTL — so the member cannot age out with the payload it points at, and the only
 * removal on a normal path is an explicit operator replay. While `moveToDlq` was
 * the only writer that was tolerable: a rare whole-group action, usually followed
 * by a replay. Now that a body-present drop dead-letters ONE job automatically
 * under a per-aggregate group id that is never reused, an index that only ever
 * grows makes the operator's primary "there is something in the dead-letter"
 * signal a number that can never come back down.
 *
 * So the readers are authoritative and the set heals behind them. These tests
 * pin both halves of that: what must be swept, and — the part that would be
 * worse to get wrong — what must never be.
 */
describe("given a group with a dead-lettered body-present job", () => {
  describe("when the quarantine window has passed and the operator checks the dead-letter count", () => {
    /** @scenario "the dead-letter count returns to zero once the dead-lettered payloads have expired" */
    it("counts nothing and stops naming the group as dead-lettered", async () => {
      await deadLetterOneBodyPresentJob();
      expect(await dlqCount()).toBe(1);

      await letTheQuarantineWindowExpire();
      // The state the bug leaves behind: nothing left to recover, still named.
      // Asserted BEFORE the read, so a zero below is the sweep's work and not
      // a seed that never landed.
      expect(await survivingPayloadKeys()).toBe(0);
      expect(await stillTracked()).toBe(1);

      expect(await dlqCount()).toBe(0);
      expect(await stillTracked()).toBe(0);
    });
  });

  describe("when the quarantine window has passed and the operator lists the dead-lettered groups", () => {
    /** @scenario "an expired dead-letter is no longer offered to the operator to act on" */
    it("omits the group and stops naming it as dead-lettered", async () => {
      await deadLetterOneBodyPresentJob();
      expect(await repo.listDlqGroups({ queueName })).toHaveLength(1);

      await letTheQuarantineWindowExpire();
      expect(await survivingPayloadKeys()).toBe(0);
      expect(await stillTracked()).toBe(1);

      expect(await repo.listDlqGroups({ queueName })).toEqual([]);
      expect(await stillTracked()).toBe(0);
    });
  });
});

describe("given a dead-lettered group that still has a recoverable job", () => {
  describe("when the operator checks the dead-letter count and lists the dead-lettered groups", () => {
    /** @scenario "a dead-letter the operator can still act on is never swept away" */
    it("counts it, lists it with its job, and keeps naming it", async () => {
      await deadLetterOneBodyPresentJob();

      expect(await dlqCount()).toBe(1);
      expect(await repo.listDlqGroups({ queueName })).toMatchObject([
        { groupId, jobCount: 1 },
      ]);
      expect(await stillTracked()).toBe(1);
    });
  });
});

describe("given a dead-lettered group that still has only the record of why it died", () => {
  describe("when the operator checks the dead-letter count and lists the dead-lettered groups", () => {
    /** @scenario "a dead-letter the operator can still act on is never swept away" */
    it("counts it, lists it with its failure record, and keeps naming it", async () => {
      await deadLetterAStaleBlock();
      // Nothing to replay — the whole reason "no recoverable jobs" cannot be
      // the liveness test. Judge by the jobs zset alone and this row, which is
      // the operator's only record of why the group died, disappears.
      expect(await redis.exists(dlqJobsKey())).toBe(0);
      expect(await redis.hlen(dlqErrorKey())).toBeGreaterThan(0);

      expect(await dlqCount()).toBe(1);
      expect(await repo.listDlqGroups({ queueName })).toMatchObject([
        { groupId, error: "handler timed out", jobCount: 0 },
      ]);
      expect(await stillTracked()).toBe(1);
    });
  });
});

describe("given a dead-lettered group the queue surfaces on two consecutive pages", () => {
  describe("when the operator checks the dead-letter count and lists the dead-lettered groups", () => {
    /** @scenario "the dead-letter total counts a group once even if the scan surfaces it twice" */
    it("counts the group once and lists it once", async () => {
      await deadLetterOneBodyPresentJob();
      const pagedRepo = new QueueRedisRepository(
        withRiggedSetScan(redis, [
          ["1", [groupId]],
          ["0", [groupId]],
        ]),
      );

      const [queue] = await pagedRepo.scanQueues({ queueNames: [queueName] });

      expect(queue!.dlqCount).toBe(1);
      expect(await pagedRepo.listDlqGroups({ queueName })).toMatchObject([
        { groupId, jobCount: 1 },
      ]);
    });
  });
});
