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
  envVar: "CLICKHOUSE_COLD_STORAGE_SPANS_TTL_DAYS",
  hardcodedDefault: 30,
};

describe("ttlReconciler", () => {
  describe("resolveHotDays()", () => {
    const savedEnv: Record<string, string | undefined> = {};

    beforeEach(() => {
      savedEnv[sampleEntry.envVar] = process.env[sampleEntry.envVar];
      savedEnv.CLICKHOUSE_COLD_STORAGE_DEFAULT_TTL_DAYS =
        process.env.CLICKHOUSE_COLD_STORAGE_DEFAULT_TTL_DAYS;
      delete process.env[sampleEntry.envVar];
      delete process.env.CLICKHOUSE_COLD_STORAGE_DEFAULT_TTL_DAYS;
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
        process.env.CLICKHOUSE_COLD_STORAGE_DEFAULT_TTL_DAYS = "14";
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
        process.env.CLICKHOUSE_COLD_STORAGE_DEFAULT_TTL_DAYS = "14";
        expect(resolveHotDays(sampleEntry)).toBe(14);
      });

      it("throws on invalid global default", () => {
        process.env.CLICKHOUSE_COLD_STORAGE_DEFAULT_TTL_DAYS = "not-a-number";
        expect(() => resolveHotDays(sampleEntry)).toThrow(
          /CLICKHOUSE_COLD_STORAGE_DEFAULT_TTL_DAYS must be a non-negative integer/,
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
        process.env.CLICKHOUSE_COLD_STORAGE_DEFAULT_TTL_DAYS = "";
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
        table: "experiment_runs",
        ttlColumn: "StartedAt",
        envVar: "CLICKHOUSE_COLD_STORAGE_EXPERIMENT_RUNS_TTL_DAYS",
        hardcodedDefault: 30,
      };
      const result = buildDesiredTTLExpression({ config: entry, days: 7 });
      expect(result).toBe(
        "toDateTime(StartedAt) + INTERVAL 7 DAY TO VOLUME 'cold'",
      );
    });

    it("uses ttlColumnExpression override when provided", () => {
      const entry: TableTTLEntry = {
        table: "event_log",
        ttlColumn: "EventOccurredAt",
        ttlColumnExpression: "toDateTime(EventOccurredAt / 1000)",
        envVar: "CLICKHOUSE_COLD_STORAGE_EVENT_LOG_TTL_DAYS",
        hardcodedDefault: 30,
      };
      const result = buildDesiredTTLExpression({ config: entry, days: 7 });
      expect(result).toBe(
        "toDateTime(EventOccurredAt / 1000) + INTERVAL 7 DAY TO VOLUME 'cold'",
      );
    });
  });

  describe("reconcileTTL()", () => {
    const savedEnv: Record<string, string | undefined> = {};

    beforeEach(() => {
      savedEnv.CLICKHOUSE_COLD_STORAGE_ENABLED = process.env.CLICKHOUSE_COLD_STORAGE_ENABLED;
      savedEnv.CLICKHOUSE_URL = process.env.CLICKHOUSE_URL;
      delete process.env.CLICKHOUSE_COLD_STORAGE_ENABLED;
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

    describe("when CLICKHOUSE_URL is not set and no connectionUrl provided", () => {
      it("skips reconciliation", async () => {
        await expect(reconcileTTL()).resolves.toBeUndefined();
      });
    });

    describe("when CLICKHOUSE_URL is set but CLICKHOUSE_COLD_STORAGE_ENABLED is not set", () => {
      it("skips reconciliation", async () => {
        process.env.CLICKHOUSE_URL = "http://localhost:8123/langwatch";
        await expect(reconcileTTL()).resolves.toBeUndefined();
      });
    });

    describe("when CLICKHOUSE_COLD_STORAGE_ENABLED is 'true' but CLICKHOUSE_URL is missing", () => {
      it("skips reconciliation", async () => {
        process.env.CLICKHOUSE_COLD_STORAGE_ENABLED = "true";
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
      it("bypasses the env var gates", async () => {
        // CLICKHOUSE_URL is not set, but connectionUrl bypasses the gate.
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
        "billable_events",
        "dspy_steps",
        "evaluation_runs",
        "event_log",
        "experiment_run_items",
        "experiment_runs",
        "simulation_runs",
        "stored_log_records",
        "stored_metric_records",
        "stored_spans",
        "trace_summaries",
      ]);
    });

    it("has unique env vars for each table", () => {
      const envVars = TABLE_TTL_CONFIG.map((c) => c.envVar);
      expect(new Set(envVars).size).toBe(envVars.length);
    });
  });
});
