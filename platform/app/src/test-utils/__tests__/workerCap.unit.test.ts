import { describe, expect, it } from "vitest";
import { applyWorkerCap } from "../workerCap";

describe("given a worker cap in the environment", () => {
  describe("when test files run one at a time", () => {
    /** @scenario "A worker cap never turns on file parallelism" */
    it("drops the cap so it cannot raise the worker count", () => {
      const env: NodeJS.ProcessEnv = { VITEST_MAX_WORKERS: "2" };

      applyWorkerCap({ env, fileParallelism: false });

      expect(env.VITEST_MAX_WORKERS).toBeUndefined();
    });
  });

  describe("when test files run in parallel", () => {
    /** @scenario "A worker cap still limits a parallel run" */
    it("keeps the cap", () => {
      const env: NodeJS.ProcessEnv = { VITEST_MAX_WORKERS: "2" };

      applyWorkerCap({ env, fileParallelism: true });

      expect(env.VITEST_MAX_WORKERS).toBe("2");
    });
  });

  describe("when no cap is set", () => {
    /** @scenario "A worker cap never turns on file parallelism" */
    it("leaves the rest of the environment alone", () => {
      const env: NodeJS.ProcessEnv = { VITEST_ISOLATE_WORKER_REDIS: "1" };

      applyWorkerCap({ env, fileParallelism: false });

      expect(env).toEqual({ VITEST_ISOLATE_WORKER_REDIS: "1" });
    });
  });
});
