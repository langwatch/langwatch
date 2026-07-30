/**
 * The gate's wiring: that it runs on every read, runs BEFORE the read, and
 * counts rather than refuses.
 *
 * Separate from convention-gate.unit.test.ts, which tests the rules themselves
 * against query text. This file tests the thing that is easy to get wrong and
 * invisible when it is: the old detector ran on the SUCCESS path, so a read
 * that timed out — the read most likely to have been unprunable — was never
 * examined at all.
 *
 * The counter is read out of the real prom-client registry rather than mocked,
 * because the metric's name and labels ARE the deliverable here: they are what
 * gets queried before anyone decides to make the gate refuse anything.
 */
import type { ClickHouseClient } from "@clickhouse/client";
import { register } from "prom-client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CONVENTION_GATE_THROWS } from "../../clickhouse/convention-gate";
import { createResilientClickHouseClient } from "../../clickhouse/resilient-client";

/** A read of a catalogued table with neither a partition nor a tenant filter. */
const VIOLATING_READ =
  "SELECT SpanId FROM stored_spans WHERE TraceId = {traceId:String}";

/** A read that breaks nothing. */
const CLEAN_READ =
  "SELECT SpanId FROM stored_spans WHERE TenantId = 'p' AND StartTime > 0";

async function violationCount({
  table,
  rule,
}: {
  table: string;
  rule: string;
}): Promise<number> {
  const metric = await register
    .getSingleMetric("clickhouse_convention_violation_total")
    ?.get();

  return (
    metric?.values.find(
      (value) => value.labels.table === table && value.labels.rule === rule,
    )?.value ?? 0
  );
}

function clientThat(query: () => Promise<unknown>): ClickHouseClient {
  return { query, insert: vi.fn() } as unknown as ClickHouseClient;
}

describe("the convention gate's wiring", () => {
  beforeEach(() => {
    register.getSingleMetric("clickhouse_convention_violation_total")?.reset();
  });

  describe("given a read that violates a rule", () => {
    /** @scenario "a violating read is counted rather than refused" */
    it("lets the read through and counts it", async () => {
      const query = vi.fn().mockResolvedValue({ rows: [] });
      const client = createResilientClickHouseClient({
        client: clientThat(query),
      });

      await expect(client.query({ query: VIOLATING_READ })).resolves.toEqual({
        rows: [],
      });
      expect(query).toHaveBeenCalledOnce();
      expect(
        await violationCount({
          table: "stored_spans",
          rule: "partition_predicate",
        }),
      ).toBe(1);
    });

    /** @scenario "the counter records the table and the rule separately" */
    it("counts each broken rule against the table on its own series", async () => {
      const client = createResilientClickHouseClient({
        client: clientThat(vi.fn().mockResolvedValue({ rows: [] })),
      });

      await client.query({ query: VIOLATING_READ });

      // Both rules are broken by this one read, and each lands on its own
      // series so one table's offences can be ranked without the other's.
      expect(
        await violationCount({
          table: "stored_spans",
          rule: "partition_predicate",
        }),
      ).toBe(1);
      expect(
        await violationCount({
          table: "stored_spans",
          rule: "tenant_predicate",
        }),
      ).toBe(1);
    });

    /** @scenario "a read is checked before it is sent, not after it returns" */
    it("counts a read that then fails against the database", async () => {
      const client = createResilientClickHouseClient({
        client: clientThat(vi.fn().mockRejectedValue(new Error("nope"))),
        maxRetries: 0,
      });

      await expect(client.query({ query: VIOLATING_READ })).rejects.toThrow();

      // The whole point of moving the check off the success path: a read that
      // fails is the read most likely to have been unprunable, and the old
      // detector never saw one.
      expect(
        await violationCount({
          table: "stored_spans",
          rule: "partition_predicate",
        }),
      ).toBe(1);
    });
  });

  describe("given a read that breaks nothing", () => {
    it("counts nothing", async () => {
      const client = createResilientClickHouseClient({
        client: clientThat(vi.fn().mockResolvedValue({ rows: [] })),
      });

      await client.query({ query: CLEAN_READ });

      expect(
        await violationCount({
          table: "stored_spans",
          rule: "partition_predicate",
        }),
      ).toBe(0);
      expect(
        await violationCount({
          table: "stored_spans",
          rule: "tenant_predicate",
        }),
      ).toBe(0);
    });
  });

  describe("given the refusing mode", () => {
    /** @scenario "refusing can be turned on, and is off unless it is" */
    it("is off unless the environment turns it on", () => {
      // Off in dev, in test and in production. Turning it on is step 3 of the
      // progression documented in convention-gate.ts, and step 1 — reading the
      // counter for a release — has not happened yet.
      expect(CONVENTION_GATE_THROWS).toBe(false);
      expect(
        process.env.LANGWATCH_CLICKHOUSE_CONVENTION_GATE ?? "unset",
      ).not.toBe("throw");
    });
  });
});
