import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  resolveHotDays,
  parseTTLDaysFromEngineMetadata,
  buildDesiredTTLExpression,
  TABLE_TTL_CONFIG,
  TIERED_STORAGE_POLICY,
  reconcileTTL,
  type TableTTLEntry,
} from "../ttlReconciler";

const sampleEntry: TableTTLEntry = {
  table: "stored_spans",
  ttlColumn: "EndTime",
  envVar: "TIERED_STORED_SPANS_TABLE_HOT_DAYS",
  hardcodedDefault: 30,
};

describe("ttlReconciler", () => {
  describe("resolveHotDays()", () => {
    const savedEnv: Record<string, string | undefined> = {};

    beforeEach(() => {
      savedEnv[sampleEntry.envVar] = process.env[sampleEntry.envVar];
      savedEnv.TIERED_STORAGE_DEFAULT_HOT_DAYS =
        process.env.TIERED_STORAGE_DEFAULT_HOT_DAYS;
      delete process.env[sampleEntry.envVar];
      delete process.env.TIERED_STORAGE_DEFAULT_HOT_DAYS;
    });

    afterEach(() => {
      for (const [key, value] of Object.entries(savedEnv)) {
        if (value === undefined) {
          delete process.env[key];
        } else {
          process.env[key] = value;
        }
      }
    });

    describe("when per-table env var is set", () => {
      it("returns the per-table value", () => {
        process.env[sampleEntry.envVar] = "7";
        expect(resolveHotDays(sampleEntry)).toBe(7);
      });

      it("takes precedence over global default", () => {
        process.env[sampleEntry.envVar] = "5";
        process.env.TIERED_STORAGE_DEFAULT_HOT_DAYS = "14";
        expect(resolveHotDays(sampleEntry)).toBe(5);
      });

      it("accepts zero", () => {
        process.env[sampleEntry.envVar] = "0";
        expect(resolveHotDays(sampleEntry)).toBe(0);
      });

      it("throws on negative value", () => {
        process.env[sampleEntry.envVar] = "-1";
        expect(() => resolveHotDays(sampleEntry)).toThrow(
          /must be a non-negative integer/,
        );
      });

      it("throws on non-numeric value", () => {
        process.env[sampleEntry.envVar] = "abc";
        expect(() => resolveHotDays(sampleEntry)).toThrow(
          /must be a non-negative integer/,
        );
      });

      it("throws on fractional value", () => {
        process.env[sampleEntry.envVar] = "3.5";
        expect(() => resolveHotDays(sampleEntry)).toThrow(
          /must be a non-negative integer/,
        );
      });
    });

    describe("when only global default is set", () => {
      it("returns the global default", () => {
        process.env.TIERED_STORAGE_DEFAULT_HOT_DAYS = "14";
        expect(resolveHotDays(sampleEntry)).toBe(14);
      });

      it("throws on invalid global default", () => {
        process.env.TIERED_STORAGE_DEFAULT_HOT_DAYS = "not-a-number";
        expect(() => resolveHotDays(sampleEntry)).toThrow(
          /TIERED_STORAGE_DEFAULT_HOT_DAYS must be a non-negative integer/,
        );
      });
    });

    describe("when no env vars are set", () => {
      it("returns the hardcoded default", () => {
        expect(resolveHotDays(sampleEntry)).toBe(30);
      });
    });

    describe("when env var is empty string", () => {
      it("treats empty per-table var as unset", () => {
        process.env[sampleEntry.envVar] = "";
        expect(resolveHotDays(sampleEntry)).toBe(30);
      });

      it("treats empty global var as unset", () => {
        process.env.TIERED_STORAGE_DEFAULT_HOT_DAYS = "";
        expect(resolveHotDays(sampleEntry)).toBe(30);
      });
    });
  });

  describe("parseTTLDaysFromEngineMetadata()", () => {
    describe("when engine_full contains TTL with toIntervalDay", () => {
      it("extracts the day count", () => {
        const engineFull =
          "MergeTree ORDER BY (TenantId) TTL toDateTime(EndTime) + toIntervalDay(30) TO VOLUME 'cold'";
        expect(parseTTLDaysFromEngineMetadata(engineFull)).toBe(30);
      });

      it("extracts single-digit day count", () => {
        const engineFull =
          "ReplicatedMergeTree() TTL toDateTime(CreatedAt) + toIntervalDay(7) TO VOLUME 'cold' SETTINGS index_granularity = 8192";
        expect(parseTTLDaysFromEngineMetadata(engineFull)).toBe(7);
      });
    });

    describe("when engine_full has no TTL clause", () => {
      it("returns null", () => {
        const engineFull =
          "MergeTree ORDER BY (TenantId) SETTINGS index_granularity = 8192";
        expect(parseTTLDaysFromEngineMetadata(engineFull)).toBeNull();
      });
    });

    describe("when engine_full is empty", () => {
      it("returns null", () => {
        expect(parseTTLDaysFromEngineMetadata("")).toBeNull();
      });
    });
  });

  describe("buildDesiredTTLExpression()", () => {
    it("builds correct TTL expression", () => {
      const result = buildDesiredTTLExpression({
        config: sampleEntry,
        days: 14,
      });
      expect(result).toBe(
        "toDateTime(EndTime) + INTERVAL 14 DAY TO VOLUME 'cold'",
      );
    });

    it("uses the ttlColumn from the config entry", () => {
      const entry: TableTTLEntry = {
        table: "event_log",
        ttlColumn: "CreatedAt",
        envVar: "TIERED_EVENT_LOG_TABLE_HOT_DAYS",
        hardcodedDefault: 30,
      };
      const result = buildDesiredTTLExpression({ config: entry, days: 7 });
      expect(result).toBe(
        "toDateTime(CreatedAt) + INTERVAL 7 DAY TO VOLUME 'cold'",
      );
    });
  });

  describe("reconcileTTL()", () => {
    const savedEnv: Record<string, string | undefined> = {};

    beforeEach(() => {
      savedEnv.ENABLE_CLICKHOUSE = process.env.ENABLE_CLICKHOUSE;
      savedEnv.ENABLE_CLICKHOUSE_TTL = process.env.ENABLE_CLICKHOUSE_TTL;
      savedEnv.CLICKHOUSE_URL = process.env.CLICKHOUSE_URL;
      delete process.env.ENABLE_CLICKHOUSE;
      delete process.env.ENABLE_CLICKHOUSE_TTL;
      delete process.env.CLICKHOUSE_URL;
    });

    afterEach(() => {
      for (const [key, value] of Object.entries(savedEnv)) {
        if (value === undefined) {
          delete process.env[key];
        } else {
          process.env[key] = value;
        }
      }
    });

    describe("when ENABLE_CLICKHOUSE is not set and no connectionUrl provided", () => {
      it("skips reconciliation", async () => {
        await expect(reconcileTTL()).resolves.toBeUndefined();
      });
    });

    describe("when ENABLE_CLICKHOUSE is 'true' but ENABLE_CLICKHOUSE_TTL is not set", () => {
      it("skips reconciliation", async () => {
        process.env.ENABLE_CLICKHOUSE = "true";
        await expect(reconcileTTL()).resolves.toBeUndefined();
      });
    });

    describe("when ENABLE_CLICKHOUSE is 'true' but CLICKHOUSE_URL is missing", () => {
      it("skips reconciliation", async () => {
        process.env.ENABLE_CLICKHOUSE = "true";
        process.env.ENABLE_CLICKHOUSE_TTL = "true";
        await expect(reconcileTTL()).resolves.toBeUndefined();
      });
    });

    describe("when connectionUrl is provided but has no database path", () => {
      it("throws a configuration error", async () => {
        await expect(
          reconcileTTL({ connectionUrl: "http://localhost:8123" }),
        ).rejects.toThrow(/Database name must be specified/);
      });
    });

    describe("when connectionUrl is provided explicitly", () => {
      it("bypasses the ENABLE_CLICKHOUSE gate", async () => {
        // ENABLE_CLICKHOUSE is not set, but connectionUrl bypasses the gate.
        // This will fail at the ClickHouse connection level (no server running),
        // proving it got past the env-var guards.
        await expect(
          reconcileTTL({ connectionUrl: "http://localhost:1/testdb" }),
        ).rejects.toThrow();
      });
    });
  });

  describe("TIERED_STORAGE_POLICY", () => {
    it("matches the infrastructure-configured policy name", () => {
      expect(TIERED_STORAGE_POLICY).toBe("local_primary");
    });
  });

  describe("TABLE_TTL_CONFIG", () => {
    it("covers all expected tables", () => {
      const tableNames = TABLE_TTL_CONFIG.map((c) => c.table);
      expect(tableNames).toEqual([
        "event_log",
        "stored_spans",
        "trace_summaries",
        "evaluation_runs",
        "experiment_runs",
        "experiment_run_items",
      ]);
    });

    it("has unique env vars for each table", () => {
      const envVars = TABLE_TTL_CONFIG.map((c) => c.envVar);
      expect(new Set(envVars).size).toBe(envVars.length);
    });
  });
});
