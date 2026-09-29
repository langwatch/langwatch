import { parseProcessConfig } from "@langwatch/config";
import { describe, expect, it } from "vitest";

import { opsBrowserConfig, opsConfig } from "../ops.config.ts";

const read = (environment: Record<string, string | undefined>) =>
  parseProcessConfig({ owners: [{ name: "ops", config: opsConfig }], environment }).ops;

describe("ops server configuration", () => {
  describe("given a deployment says nothing about backup metrics", () => {
    /** @scenario "A feature's defaults are the values a deployment already runs on" */
    it("keeps collection on, so live monitoring is not disarmed by omission", () => {
      expect(read({}).collectClickHouseBackupMetrics).toBe(true);
      expect(read({ CLICKHOUSE_BACKUP_METRICS_ENABLED: "" }).collectClickHouseBackupMetrics).toBe(
        true,
      );
    });
  });

  describe("given a deployment turns backup metrics off", () => {
    /** @scenario "A feature reads its configuration through its own schema" */
    it("reads every spelling the deployment already used", () => {
      for (const value of ["false", "0", "no", "off", "OFF", " off "]) {
        expect(
          read({ CLICKHOUSE_BACKUP_METRICS_ENABLED: value }).collectClickHouseBackupMetrics,
        ).toBe(false);
      }
    });
  });

  describe("given usage statistics are opted out of", () => {
    /** @scenario "A feature reads its configuration through its own schema" */
    it("reads the opt-out at the deployment's own spelling", () => {
      expect(read({ DISABLE_USAGE_STATS: "1" }).usageStats.disabled).toBe(true);
      expect(read({}).usageStats.disabled).toBe(false);
    });
  });

  describe("given a deployment does not ask for Cloud admin", () => {
    /** @scenario "Cloud admin is on only when asked for and the licence key matches the release" */
    it("keeps LANGWATCH_CLOUD_OPS off by default", () => {
      expect(read({}).cloudOps).toBe(false);
      expect(read({ LANGWATCH_CLOUD_OPS: "false" }).cloudOps).toBe(false);
    });
  });

  describe("given a deployment asks for Cloud admin", () => {
    /** @scenario "Cloud admin is on only when asked for and the licence key matches the release" */
    it("reads the switch as a boolean and refuses anything else", () => {
      expect(read({ LANGWATCH_CLOUD_OPS: "true" }).cloudOps).toBe(true);
      expect(read({ LANGWATCH_CLOUD_OPS: "1" }).cloudOps).toBe(true);
      expect(() => read({ LANGWATCH_CLOUD_OPS: "maybe" })).toThrow(/LANGWATCH_CLOUD_OPS/);
    });
  });

  describe("given the browser is told what ops answers", () => {
    /** @scenario "The browser learns Cloud admin from what the ops process answered" */
    it("projects the running answer and never the switch or a key", async () => {
      const config = read({ LANGWATCH_CLOUD_OPS: "true" });

      await expect(
        opsBrowserConfig.project(config, { offersCloudOps: () => false }),
      ).resolves.toEqual({ cloudOps: false });
      await expect(
        opsBrowserConfig.project(config, { offersCloudOps: () => true }),
      ).resolves.toEqual({ cloudOps: true });
    });
  });
});
