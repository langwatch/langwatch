import { describe, expect, it } from "vitest";
import {
  assertSerialWorkerSlot,
  withdrawWorkerCountOverride,
} from "../integration-file-concurrency";

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
