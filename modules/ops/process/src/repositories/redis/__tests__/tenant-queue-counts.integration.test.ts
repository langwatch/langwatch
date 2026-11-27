/**
 * Staff ops counts of one tenant's group queue work, against real Redis.
 * @see modules/ops/specs/tenant-queue-counts.feature
 */
import { randomUUID } from "node:crypto";

import IORedis, { type Redis } from "ioredis";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { QueueRedisRepository } from "../queue.repository.ts";

const redisUrl =
  process.env.LANGWATCH_TEST_REDIS_URL ?? process.env.REDIS_URL ?? process.env.CI_REDIS_URL;

describe.skipIf(!redisUrl)("tenant queue group counts", () => {
  const run = randomUUID().slice(0, 8);
  const queueName = `tenant-counts-${run}`;
  const otherQueueName = `tenant-counts-other-${run}`;
  const prefix = `${queueName}:gq:`;
  const otherPrefix = `${otherQueueName}:gq:`;
  const project = `project_${run}`;
  const otherProject = `project_other_${run}`;
  const organization = `organization_${run}`;
  let redis: Redis;
  let repository: QueueRedisRepository;

  const count = (tenantIds: string[]) =>
    repository.countTenantGroups({
      queueNames: [queueName, otherQueueName],
      tenantIds,
      scanBudget: 10_000,
      jobReadBudget: 1_000,
    });

  const addJobs = async (keyPrefix: string, groupId: string, scores: number[]) => {
    for (const [index, score] of scores.entries()) {
      await redis.zadd(`${keyPrefix}group:${groupId}:jobs`, score, `${groupId}-job-${index}`);
      await redis.hset(
        `${keyPrefix}group:${groupId}:data`,
        `${groupId}-job-${index}`,
        JSON.stringify({ prompt: "secret payload text" }),
      );
    }
  };

  beforeAll(async () => {
    redis = new IORedis(redisUrl!);
    repository = QueueRedisRepository.create({ redis });
    const now = Date.now();

    await redis.zadd(`${prefix}ready`, 100, `${project}/fold/trace:1`);
    await redis.zadd(`${prefix}ready`, 200, `${project}/job/topic`);
    await redis.zadd(`${prefix}ready`, 300, `${otherProject}/fold/trace:9`);
    await redis.zadd(`${prefix}ready`, 400, `${organization}/fold/usage:1`);
    await addJobs(prefix, `${project}/fold/trace:1`, [1000, 1500]);
    await addJobs(prefix, `${project}/job/topic`, [900]);
    await addJobs(prefix, `${otherProject}/fold/trace:9`, [100]);
    await addJobs(prefix, `${organization}/fold/usage:1`, [800]);

    await redis.sadd(`${prefix}blocked`, `${project}/fold/trace:blocked`, `${otherProject}/x`);
    await redis.hset(
      `${prefix}group:${project}/fold/trace:blocked:error`,
      "message",
      "secret error text",
    );
    await redis.zadd(
      `${prefix}tenant_active_z:${project}`,
      now + 60_000,
      `${project}/fold/trace:1`,
    );
    await redis.zadd(`${prefix}tenant_active_z:${project}`, now - 1_000, `${project}/fold/lapsed`);
    await redis.zadd(`${prefix}parked:${project}`, 50, `${project}/fold/trace:parked`);
    await addJobs(prefix, `${project}/fold/trace:parked`, [700]);
    await redis.sadd(`${prefix}dlq`, `${project}/fold/trace:dead`, `${otherProject}/fold/dead`);

    await redis.zadd(`${otherPrefix}ready`, 10, `${otherProject}/fold/trace:2`);
    await addJobs(otherPrefix, `${otherProject}/fold/trace:2`, [10]);
  });

  afterAll(async () => {
    for (const keyPrefix of [prefix, otherPrefix]) {
      const keys = await redis.keys(`${keyPrefix}*`);
      if (keys.length > 0) await redis.del(...keys);
    }
    await redis.quit();
  });

  /** @scenario "A tenant's groups are counted per queue" */
  it("counts each state of the tenant's groups, its waiting jobs and the oldest job", async () => {
    expect(await count([project])).toEqual([
      {
        queueName,
        pendingGroups: 2,
        blockedGroups: 1,
        activeGroups: 1,
        parkedGroups: 1,
        dlqGroups: 1,
        pendingJobs: 4,
        oldestPendingAt: 700,
      },
    ]);
  });

  /** @scenario "Another tenant's groups are never counted" */
  it("counts only the named tenant and leaves out queues holding none of its groups", async () => {
    const counts = await count([project]);
    expect(counts.map((entry) => entry.queueName)).toEqual([queueName]);

    const other = await count([otherProject]);
    expect(other).toEqual([
      {
        queueName,
        pendingGroups: 1,
        blockedGroups: 1,
        activeGroups: 0,
        parkedGroups: 0,
        dlqGroups: 1,
        pendingJobs: 1,
        oldestPendingAt: 100,
      },
      {
        queueName: otherQueueName,
        pendingGroups: 1,
        blockedGroups: 0,
        activeGroups: 0,
        parkedGroups: 0,
        dlqGroups: 0,
        pendingJobs: 1,
        oldestPendingAt: 10,
      },
    ]);
  });

  /** @scenario "Project and organization tenant ids are counted together" */
  it("sums a project's groups with its organization's groups", async () => {
    expect(await count([project, organization])).toEqual([
      expect.objectContaining({
        queueName,
        pendingGroups: 3,
        pendingJobs: 5,
        oldestPendingAt: 700,
      }),
    ]);
  });

  /** @scenario "The counts carry no key, payload or error text" */
  it("answers no group key, payload or error text", async () => {
    const answered = JSON.stringify(await count([project, organization]));
    for (const text of [
      project,
      organization,
      "fold",
      "secret payload text",
      "secret error text",
    ]) {
      expect(answered).not.toContain(text);
    }
  });
});
