/**
 * These tests run the real spawn rather than asserting on the option, since
 * the option is only worth anything if it carries output of that size.
 * @see ../goose.migration-runner.ts
 * @see ../../../../specs/clickhouse/migration-output-buffer.feature
 */

import { spawnSync } from "node:child_process";

import { describe, expect, it } from "vitest";

import { messageForSpawnError } from "../goose.migration-runner";

/** Prints two megabytes, which is past the one megabyte `spawnSync` allows. */
const PRINTS_TWO_MEGABYTES = ["-e", 'process.stdout.write("x".repeat(2 * 1024 * 1024))'];

describe("given a verbose migration run", () => {
  describe("when the child prints more than one megabyte", () => {
    /** @scenario "A run whose output passes a megabyte still succeeds" */
    it("captures the whole output under the migrations' buffer", () => {
      const result = spawnSync(process.execPath, PRINTS_TWO_MEGABYTES, {
        encoding: "utf-8",
        stdio: "pipe",
        maxBuffer: 64 * 1024 * 1024,
      });

      expect(result.error).toBeUndefined();
      expect(result.stdout).toHaveLength(2 * 1024 * 1024);
    });

    /** @scenario "A run cut off by the buffer says so" */
    it("reports the default buffer as the ENOBUFS the fix removes", () => {
      const result = spawnSync(process.execPath, PRINTS_TWO_MEGABYTES, {
        encoding: "utf-8",
        stdio: "pipe",
        maxBuffer: 1024 * 1024,
      });

      expect(result.error?.message).toContain("ENOBUFS");

      const message = messageForSpawnError(result.error?.message ?? "");
      expect(message).toContain("cut off");
      expect(message).toContain("cannot say whether the migrations applied");
    });
  });

  describe("when the goose binary is absent", () => {
    /** @scenario "A missing goose binary still says how to install it" */
    it("names the install page", () => {
      const message = messageForSpawnError("spawnSync goose-does-not-exist ENOENT");

      expect(message).toContain("github.com/pressly/goose");
    });
  });
});
