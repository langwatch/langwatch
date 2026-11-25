import { describe, expect, it } from "vitest";

import {
  assertSerialWorkerSlot,
  raiseWorkerCountInCI,
  withdrawWorkerCountOverride,
} from "../integration-file-concurrency.ts";

/** A fresh environment, so no test reads another's variables. */
function env(overrides: Record<string, string>): NodeJS.ProcessEnv {
  return { ...overrides } as NodeJS.ProcessEnv;
}

describe("given the integration suite decides whether its files run concurrently", () => {
  describe("when the environment asks for a worker count", () => {
    /** @scenario "The runner exports a worker count while files are serial" */
    it("withdraws it while files are serial", () => {
      const processEnv = env({ VITEST_MAX_WORKERS: "2" });

      withdrawWorkerCountOverride(processEnv);

      expect(processEnv.VITEST_MAX_WORKERS).toBeUndefined();
    });

    /** @scenario "Concurrency is asked for deliberately" */
    it("honours it once concurrent files are asked for", () => {
      const processEnv = env({
        VITEST_MAX_WORKERS: "2",
        VITEST_INTEGRATION_PARALLEL: "1",
      });

      withdrawWorkerCountOverride(processEnv);

      expect(processEnv.VITEST_MAX_WORKERS).toBe("2");
    });
  });

  describe("when an isolated suite asks for more workers in CI", () => {
    /** @scenario "A heavy integration suite whose files are isolated runs more of them at once in CI" */
    it("sets the worker count and asks for concurrent files by name", () => {
      const processEnv = env({ CI: "true", VITEST_MAX_WORKERS: "2" });

      raiseWorkerCountInCI({ env: processEnv, workers: 3 });

      expect(processEnv.VITEST_MAX_WORKERS).toBe("3");
      expect(processEnv.VITEST_INTEGRATION_PARALLEL).toBe("1");
      expect(() => assertSerialWorkerSlot({ ...processEnv, VITEST_POOL_ID: "3" })).not.toThrow();
    });

    /** @scenario "A heavy integration suite whose files are isolated runs more of them at once in CI" */
    it("raises an unset count, and leaves one someone exported", () => {
      const unset = env({ CI: "true" });
      raiseWorkerCountInCI({ env: unset, workers: 3 });
      expect(unset.VITEST_MAX_WORKERS).toBe("3");

      const exported = env({ CI: "true", VITEST_MAX_WORKERS: "1" });
      raiseWorkerCountInCI({ env: exported, workers: 3 });
      expect(exported.VITEST_MAX_WORKERS).toBe("1");
      expect(exported.VITEST_INTEGRATION_PARALLEL).toBeUndefined();
    });

    /** @scenario "A heavy integration suite whose files are isolated runs more of them at once in CI" */
    it("leaves the launcher's count alone off CI", () => {
      for (const ci of [undefined, "false", "0"]) {
        const processEnv = env({
          VITEST_MAX_WORKERS: "2",
          ...(ci === undefined ? {} : { CI: ci }),
        });

        raiseWorkerCountInCI({ env: processEnv, workers: 3 });

        expect(processEnv.VITEST_MAX_WORKERS).toBe("2");
        expect(processEnv.VITEST_INTEGRATION_PARALLEL).toBeUndefined();
      }
    });
  });

  describe("when a worker slot above the first appears", () => {
    /** @scenario "A second worker starts while files are serial" */
    it("fails naming the variable that re-enabled concurrency", () => {
      expect(() => assertSerialWorkerSlot(env({ VITEST_POOL_ID: "2" }))).toThrowError(
        /VITEST_MAX_WORKERS/,
      );
    });

    /** @scenario "A second worker starts in a deliberately parallel run" */
    it("proceeds when concurrent files were asked for", () => {
      expect(() =>
        assertSerialWorkerSlot(env({ VITEST_POOL_ID: "2", VITEST_INTEGRATION_PARALLEL: "1" })),
      ).not.toThrow();
    });
  });

  describe("when the only worker slot appears", () => {
    /** @scenario "The only worker starts" */
    it("proceeds", () => {
      expect(() => assertSerialWorkerSlot(env({ VITEST_POOL_ID: "1" }))).not.toThrow();
      expect(() => assertSerialWorkerSlot(env({}))).not.toThrow();
    });
  });
});
