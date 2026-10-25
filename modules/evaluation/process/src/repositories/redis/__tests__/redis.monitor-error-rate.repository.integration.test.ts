/**
 * @vitest-environment node
 * @see modules/evaluation/specs/monitor-error-rate.feature
 */
import { type RedisConnection, RedisConnectionService } from "@langwatch/redis-client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { RedisMonitorErrorRateRepository } from "../redis.monitor-error-rate.repository.ts";

const redisUrl = process.env.LANGWATCH_TEST_REDIS_URL;
const KEY = {
  projectId: `project-${Date.now()}`,
  monitorId: "monitor-1",
  monitorRevision: 1_792_922_400_000,
};
const NOW = 1_792_922_700_000;

describe.skipIf(!redisUrl)("the monitor error-rate counts over Redis", () => {
  let redis: RedisConnection;

  beforeAll(() => {
    redis = new RedisConnectionService().connect({
      url: redisUrl,
      clusterEndpoints: undefined,
      dbIndex: undefined,
    })!;
  });

  afterAll(async () => {
    const base = `evaluation:monitor_error_rate:{${KEY.projectId}:${KEY.monitorId}:${KEY.monitorRevision}}`;
    await redis?.del(`${base}:counts`, `${base}:messages`, `${base}:reported`);
    await redis?.quit();
  });

  describe("when two workers each record half of a revision's runs", () => {
    /** @scenario "The window counts are shared through Redis" */
    it("reads the same counts from both and lets one claim the report", async () => {
      const workerA = RedisMonitorErrorRateRepository.create({ redis });
      const workerB = RedisMonitorErrorRateRepository.create({ redis });

      for (let index = 0; index < 25; index++) {
        await workerA.record({
          ...KEY,
          outcome: "error",
          errorMessage: "Evaluator timed out",
          now: NOW,
        });
        await workerB.record({
          ...KEY,
          outcome: index < 20 ? "error" : "processed",
          ...(index < 20
            ? { errorMessage: index < 2 ? "Rate limited" : "Evaluator timed out" }
            : {}),
          now: NOW + 60_000,
        });
      }
      const counts = await workerA.record({ ...KEY, outcome: "processed", now: NOW + 120_000 });

      expect(counts).toEqual({ runs: 51, errors: 45 });
      expect(await workerB.findTopErrors(KEY)).toEqual(["Evaluator timed out", "Rate limited"]);
      expect(await workerA.claimReport(KEY)).toBe(true);
      expect(await workerB.claimReport(KEY)).toBe(false);

      await workerB.releaseReport(KEY);
      expect(await workerB.claimReport(KEY)).toBe(true);
    });
  });

  describe("when a bucket is older than the hour", () => {
    it("leaves it out of the counts", async () => {
      const repository = RedisMonitorErrorRateRepository.create({ redis });
      const later = NOW + 2 * 60 * 60 * 1000;

      expect(await repository.record({ ...KEY, outcome: "error", now: later })).toEqual({
        runs: 1,
        errors: 1,
      });
    });
  });
});
