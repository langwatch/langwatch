import { RuntimeConfig } from "@langwatch/config";
import { describe, expect, it } from "vitest";
import { opsServerConfigDefinition } from "../ops.config.ts";

const read = (source: Record<string, unknown>) =>
  RuntimeConfig.create({ name: "ops", definition: opsServerConfigDefinition, source }).value;

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
});
