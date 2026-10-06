/**
 * @vitest-environment node
 * @see specs/upgrade/live-test-fixtures.feature
 */
import { describe, expect, it } from "vitest";

import {
  createLiveUpgrade,
  liveUpgradeCommand,
  type LiveUpgradeOutcome,
  type RunLiveUpgrade,
} from "../live-upgrade.ts";

const STORES = {
  databaseUrl: "postgresql://postgres@127.0.0.1:55433/langwatch_test",
  redisUrl: "redis://127.0.0.1:56379",
  clickHouseUrl: "http://127.0.0.1:58123/live_suite",
};

/** A recording upgrade: every environment it was run with, answering `outcome`. */
function recordingUpgrade(outcome: LiveUpgradeOutcome) {
  const runs: Readonly<Record<string, string>>[] = [];
  const run: RunLiveUpgrade = async (environment) => {
    runs.push(environment);
    return outcome;
  };
  return { run, runs };
}

describe("the live fixtures' upgrade", () => {
  describe("given a test database whose upgrade has not run", () => {
    /** @scenario "A live test boots against a test database whose upgrade has not run" */
    it("runs the upgrade once per test process with only the test stores, then lets every boot go on", async () => {
      const { run, runs } = recordingUpgrade({ exitCode: 0, output: "" });
      const upgradedLiveDatabase = createLiveUpgrade({ run, path: "/usr/bin" });

      await Promise.all([upgradedLiveDatabase(STORES), upgradedLiveDatabase(STORES)]);
      await upgradedLiveDatabase(STORES);

      expect(runs).toEqual([
        {
          PATH: "/usr/bin",
          NODE_ENV: "test",
          DATABASE_URL: STORES.databaseUrl,
          REDIS_URL: STORES.redisUrl,
          CLICKHOUSE_URL: STORES.clickHouseUrl,
        },
      ]);
    });

    it("spawns the tasks entry itself in the tasks directory it is handed, naming no env file", () => {
      const command = liveUpgradeCommand({ tasksDirectory: "/checkout/apps/tasks/" });

      expect(command.cwd).toBe("/checkout/apps/tasks/");
      expect(command.args).toEqual(["--experimental-transform-types", "src/main.ts", "upgrade"]);
      expect(command.args.some((arg) => arg.includes("env-file"))).toBe(false);
    });
  });

  describe("when the upgrade exits non-zero", () => {
    /** @scenario "The live fixture fails the test by name when the upgrade fails" */
    it("fails every boot by code with the exit code and output, and never runs it again", async () => {
      const { run, runs } = recordingUpgrade({ exitCode: 3, output: "upgrade lease not acquired" });
      const upgradedLiveDatabase = createLiveUpgrade({ run, path: undefined });

      const first = await upgradedLiveDatabase(STORES).catch((error: unknown) => error);
      const second = await upgradedLiveDatabase(STORES).catch((error: unknown) => error);

      expect(first).toMatchObject({
        code: "live_upgrade_failed",
        outcome: { exitCode: 3, output: "upgrade lease not acquired" },
      });
      expect(second).toBe(first);
      expect(runs).toHaveLength(1);
    });
  });
});
