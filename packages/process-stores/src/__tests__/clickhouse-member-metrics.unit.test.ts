/**
 * The ClickHouse member wires the package's metric ports to the process's metrics, under
 * the names main's dashboards read.
 * @see specs/clickhouse/windowed-read-fallback.feature
 * @see specs/ops/clickhouse-statement-reporting.feature
 */
import { createServer, type Server } from "node:http";

import { queryWindowed } from "@langwatch/clickhouse-client";
import { createRecordingMeterProvider } from "@langwatch/observability/metrics/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { buildClickHouse } from "../clickhouse-member.ts";

const metrics = createRecordingMeterProvider();
const directory = { organizationForTenant: () => Promise.resolve("organization-1") };

let server: Server;
let url: string;

beforeAll(async () => {
  metrics.install();
  server = createServer((request, response) => {
    request.resume();
    request.on("end", () => {
      response.setHeader("Content-Type", "application/x-ndjson");
      response.end();
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("No port was bound.");
  url = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  metrics.uninstall();
  await new Promise((resolve) => server.close(resolve));
});

describe("given a process that built its ClickHouse member", () => {
  describe("when a windowed read answers inside its window", () => {
    /** @scenario "a process's windowed reads are counted on its metrics" */
    it("counts it on clickhouse_windowed_read_total by table and outcome", async () => {
      const member = buildClickHouse({ config: { url }, directory });
      try {
        await queryWindowed({
          table: "trace_summaries",
          hintMs: Date.now(),
          fallback: "none",
          isEmpty: (rows: unknown[]) => rows.length === 0,
          run: async () => [1],
        });
      } finally {
        await member.close?.();
      }

      expect(metrics.recorded).toContainEqual({
        instrument: "clickhouse_windowed_read_total",
        value: 1,
        attributes: { table: "trace_summaries", outcome: "hit" },
      });
    });
  });

  describe("when a read reaches the server", () => {
    /** @scenario "The process member counts statements under main's metric names" */
    it("records its duration and a success under main's metric names", async () => {
      const member = buildClickHouse({ config: { url }, directory });
      try {
        await member.value.query({
          tenantId: "project-1",
          sql: "SELECT 1",
          unscoped: { reason: "a probe with no tenant table" },
        });
      } finally {
        await member.close?.();
      }

      expect(metrics.recorded).toContainEqual({
        instrument: "clickhouse_query_total",
        value: 1,
        attributes: { query_type: "SELECT", status: "success" },
      });
      expect(metrics.recorded).toContainEqual(
        expect.objectContaining({
          instrument: "clickhouse_query_duration_seconds",
          attributes: { query_type: "SELECT", table: "unknown" },
        }),
      );
    });
  });
});
