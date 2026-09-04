/**
 * Spec: specs/ops/worker-operational-loops.feature
 *
 * The gauges these feed are the only producer for the table-size, disk and
 * backup alerts, so the two things asserted here are the two ways they lie:
 * reporting a table that no longer exists, and letting one unreachable
 * endpoint take every other endpoint's numbers off the dashboard.
 */
import { describe, expect, it } from "vitest";

import { StorageStatsMetricsPort } from "../../ports/storage-stats-metrics.port";
import {
  StorageStatsCollectionService,
  type StorageStatsClickHouseClient,
} from "../storage-stats-collection.service";

type TableSeries = { instance: string; table: string; rows: number; bytes: number; parts: number };
type DiskSeries = { instance: string; disk: string };

class RecordingMetrics extends StorageStatsMetricsPort {
  readonly tables = new Map<string, TableSeries>();
  readonly disks = new Map<string, DiskSeries>();

  beginTick(instance: string): void {
    for (const [key, value] of this.tables) {
      if (value.instance === instance) this.tables.delete(key);
    }
  }

  recordTable(input: TableSeries): void {
    this.tables.set(`${input.instance} ${input.table}`, input);
  }

  recordDisk(input: DiskSeries): void {
    this.disks.set(`${input.instance} ${input.disk}`, input);
  }

  recordBackupStatus(): void {}

  recordLastBackup(): void {}
}

/** Answers each system-table query from a script, by the table it names. */
function clientReturning(script: {
  parts?: Array<Record<string, string>>;
  disks?: Array<Record<string, string>>;
  refuse?: boolean;
}): StorageStatsClickHouseClient {
  return {
    query: async ({ query }) => {
      if (script.refuse) throw new Error("connection refused");
      const data = query.includes("system.disks") ? (script.disks ?? []) : (script.parts ?? []);
      return { json: async () => ({ data }) };
    },
  } as StorageStatsClickHouseClient;
}

function tableRow(table: string, rows: string): Record<string, string> {
  return { table, total_rows: rows, total_bytes: "2048", parts_count: "3" };
}

describe("given an endpoint holding rows in monitored tables", () => {
  describe("when the collection ticks", () => {
    /** @scenario "Every monitored table is reported with its endpoint" */
    it("records each table's rows, bytes and parts against that endpoint", async () => {
      const metrics = new RecordingMetrics();
      const service = StorageStatsCollectionService.create({
        resolveInstances: async () => [
          {
            target: "shared",
            client: clientReturning({
              parts: [tableRow("stored_spans", "10"), tableRow("trace_summaries", "4")],
              disks: [{ name: "default", total_space: "100", free_space: "40", used_space: "60" }],
            }),
          },
        ],
        metrics,
        collectBackups: false,
      });

      await service.collect();

      expect([...metrics.tables.values()]).toEqual([
        { instance: "shared", table: "stored_spans", rows: 10, bytes: 2048, parts: 3 },
        { instance: "shared", table: "trace_summaries", rows: 4, bytes: 2048, parts: 3 },
      ]);
      expect([...metrics.disks.keys()]).toEqual(["shared default"]);
    });
  });

  describe("when the next tick no longer finds a table", () => {
    /** @scenario "A table that has dropped to nothing stops being reported" */
    it("stops reporting it rather than holding it at its last size", async () => {
      const metrics = new RecordingMetrics();
      let parts = [tableRow("stored_spans", "10"), tableRow("events", "7")];
      const service = StorageStatsCollectionService.create({
        resolveInstances: async () => [
          {
            target: "shared",
            client: clientReturning({
              get parts() {
                return parts;
              },
            }),
          },
        ],
        metrics,
        collectBackups: false,
      });

      await service.collect();
      parts = [tableRow("stored_spans", "10")];
      await service.collect();

      expect([...metrics.tables.keys()]).toEqual(["shared stored_spans"]);
    });
  });
});

describe("given two configured endpoints, one of which refuses the read", () => {
  describe("when the collection ticks", () => {
    /** @scenario "An unreachable endpoint does not take the others with it" */
    it("still reports the reachable endpoint", async () => {
      const metrics = new RecordingMetrics();
      const service = StorageStatsCollectionService.create({
        resolveInstances: async () => [
          { target: "private-acme", client: clientReturning({ refuse: true }) },
          { target: "shared", client: clientReturning({ parts: [tableRow("event_log", "1")] }) },
        ],
        metrics,
        collectBackups: false,
      });

      await service.collect();

      expect([...metrics.tables.keys()]).toEqual(["shared event_log"]);
    });
  });
});
