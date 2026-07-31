/**
 * The gate's wiring: it runs on every read, runs BEFORE the read, and
 * refuses by default.
 *
 * Separate from convention-gate.unit.test.ts, which tests the rules themselves
 * against query text. This file tests the thing that is easy to get wrong and
 * invisible when it is: the old detector ran on the SUCCESS path, so a read
 * that timed out — the read most likely to have been unprunable — was never
 * examined at all.
 *
 * The counter is read out of the real prom-client registry rather than mocked,
 * because the metric's name and labels ARE the deliverable: they are what an
 * operator queries when a refusal fires.
 */
import type { ClickHouseClient } from "@clickhouse/client";
import { register } from "prom-client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  CONVENTION_GATE_THROWS,
  enforceConventions,
  findConventionViolations,
  UnprunedClickHouseReadError,
} from "../../clickhouse/convention-gate";
import { retentionBound } from "../../clickhouse/retention-bound";
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
    /** @scenario a violating read is refused before it is sent */
    it("refuses before the driver is called, counts, and names the fix", async () => {
      const query = vi.fn().mockResolvedValue({ rows: [] });
      const client = createResilientClickHouseClient({
        client: clientThat(query),
      });

      await expect(client.query({ query: VIOLATING_READ })).rejects.toThrow(
        UnprunedClickHouseReadError,
      );
      await expect(client.query({ query: VIOLATING_READ })).rejects.toThrow(
        /retentionBound/,
      );
      expect(query).not.toHaveBeenCalled();
      expect(
        await violationCount({
          table: "stored_spans",
          rule: "partition_predicate",
        }),
      ).toBeGreaterThan(0);
    });

    /** @scenario the counter records the table and the rule separately */
    it("counts each broken rule against the table on its own series", () => {
      const seen: Array<{ table: string; rule: string }> = [];
      expect(() =>
        enforceConventions(VIOLATING_READ, {
          onViolation: (violation) => seen.push(violation),
        }),
      ).toThrow(UnprunedClickHouseReadError);

      expect(seen).toContainEqual({
        table: "stored_spans",
        rule: "partition_predicate",
      });
      expect(seen).toContainEqual({
        table: "stored_spans",
        rule: "tenant_predicate",
      });
    });

    /** @scenario a read is checked before it is sent, not after it returns */
    it("counts and refuses without ever reaching the database", async () => {
      const query = vi.fn().mockRejectedValue(new Error("nope"));
      const client = createResilientClickHouseClient({
        client: clientThat(query),
        maxRetries: 0,
      });

      await expect(client.query({ query: VIOLATING_READ })).rejects.toThrow(
        UnprunedClickHouseReadError,
      );
      expect(query).not.toHaveBeenCalled();
      expect(
        await violationCount({
          table: "stored_spans",
          rule: "partition_predicate",
        }),
      ).toBe(1);
    });
  });

  describe("given a read that breaks nothing", () => {
    it("counts nothing and lets the read through", async () => {
      const query = vi.fn().mockResolvedValue({ rows: [] });
      const client = createResilientClickHouseClient({
        client: clientThat(query),
      });

      await client.query({ query: CLEAN_READ });

      expect(query).toHaveBeenCalledOnce();
      expect(
        await violationCount({
          table: "stored_spans",
          rule: "partition_predicate",
        }),
      ).toBe(0);
    });
  });

  describe("given the gate's default mode", () => {
    it("refuses unless the environment relaxes it to warn", () => {
      expect(CONVENTION_GATE_THROWS).toBe(true);
      expect(
        process.env.LANGWATCH_CLICKHOUSE_CONVENTION_GATE ?? "unset",
      ).not.toBe("warn");
    });
  });

  describe("given warn mode", () => {
    /** @scenario warn mode counts without refusing, as the operational parachute */
    it("counts the violation and lets the read proceed", () => {
      const seen: Array<{ table: string; rule: string }> = [];
      expect(() =>
        enforceConventions(
          VIOLATING_READ,
          { onViolation: (violation) => seen.push(violation) },
          false,
        ),
      ).not.toThrow();
      expect(seen.length).toBeGreaterThan(0);
    });
  });

  describe("given a fault in the reporting hooks", () => {
    /** @scenario a checker fault never refuses a read */
    it("still applies the verdict of the check, never the fault", () => {
      // A hook fault must not change the verdict: the violation still refuses.
      expect(() =>
        enforceConventions(VIOLATING_READ, {
          onViolation: () => {
            throw new Error("registry down");
          },
        }),
      ).toThrow(UnprunedClickHouseReadError);
      // And a clean read stays clean even with faulting hooks wired.
      expect(() =>
        enforceConventions(CLEAN_READ, {
          onViolation: () => {
            throw new Error("registry down");
          },
        }),
      ).not.toThrow();
    });
  });

  describe("given a read with no estimable time range", () => {
    /** @scenario a read with no estimable time range states it and passes */
    it("passes the gate with the retentionBound statement spliced in", () => {
      const bound = retentionBound({ column: "StartTime" });
      const sql =
        "SELECT SpanId FROM stored_spans " +
        `WHERE TenantId = {tenantId:String} ${bound.fragment}`;

      expect(findConventionViolations(sql)).toEqual([]);

      // The bound sits at the widest range a live row can occupy: the
      // retention window plus the lazy-TTL cushion.
      const from = bound.params.retentionBoundFrom;
      expect(from).toBeInstanceOf(Date);
      const days = (Date.now() - (from as Date).getTime()) / 86_400_000;
      expect(days).toBeGreaterThan(308);
      expect(days).toBeLessThan(341);
    });
  });
});
