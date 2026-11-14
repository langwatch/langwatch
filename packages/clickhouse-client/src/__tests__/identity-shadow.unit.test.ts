/**
 * The shadow sampler (ADR-202 rollout step 3): a sampled reader read re-run as a count under the
 * enforcing identity, reported by table when the counts differ, and never felt by the caller.
 * @see specs/clickhouse/app-reader-identity.feature
 */
import { describe, expect, it } from "vitest";

import { ClickHouseQueryClient } from "../client.ts";
import { type ShadowDivergence, ShadowSampler } from "../identity/shadowSampler.ts";
import { TENANT_IDS_SETTING } from "../identity/tenantSetting.ts";
import type { QueryDriver, QueryRequest } from "../query.ts";
import { TenantGuard } from "../tenantGuard.ts";

/** A driver that records each read and answers the rows it was given, or the failure. */
function answering(answer: () => Promise<unknown[]>): QueryDriver & { sent: QueryRequest[] } {
  const sent: QueryRequest[] = [];
  return {
    sent,
    execute: async <Row>(request: QueryRequest) => {
      sent.push(request);
      return { rows: (await answer()) as Row[] };
    },
    async *stream<Row>(): AsyncGenerator<Row[]> {
      yield [];
    },
    command: async () => undefined,
    insert: async () => undefined,
  };
}

const TENANT_READ: QueryRequest = {
  tenantId: "project_a",
  sql: "SELECT TraceId FROM trace_summaries WHERE TenantId = {tenantId:String};",
  params: { tenantId: "project_a" },
  table: "trace_summaries",
};

function sampled({ rate, enforcing }: { rate: number; enforcing: QueryDriver }) {
  const divergences: ShadowDivergence[] = [];
  const failures: { table: string; error: unknown }[] = [];
  const settled: Promise<void>[] = [];
  const sampler = new ShadowSampler({
    driver: enforcing,
    rate,
    random: () => 0.5,
    onDivergence: (divergence) => divergences.push(divergence),
    onFailure: (failure) => failures.push(failure),
  });
  const observe = sampler.observe.bind(sampler);
  sampler.observe = (input) => {
    const run = observe(input);
    if (run !== undefined) settled.push(run);
    return run;
  };
  const system = answering(async () => [{ name: "TenantId" }]);
  const reader = answering(async () => [{ TraceId: "t1" }, { TraceId: "t2" }, { TraceId: "t3" }]);
  const client = new ClickHouseQueryClient({
    driver: system,
    readerDriver: reader,
    tenantGuard: new TenantGuard(),
    shadowSampler: sampler,
  });
  return { client, system, divergences, failures, settle: () => Promise.all(settled) };
}

describe("given a shadow sampler over the enforcing reader", () => {
  describe("when a sampled reader read returns rows the policy would hide", () => {
    /** @scenario "A sampled reader read is re-run as a count under the enforcing identity" */
    it("re-runs it as a count with the read's params and tenant setting and reports the table", async () => {
      const enforcing = answering(async () => [{ enforced: "1" }]);
      const { client, divergences, settle } = sampled({ rate: 1, enforcing });

      const result = await client.query(TENANT_READ);
      await settle();

      expect(result.rows).toHaveLength(3);
      expect(enforcing.sent).toEqual([
        expect.objectContaining({
          sql:
            "SELECT count() AS enforced FROM " +
            "(SELECT TraceId FROM trace_summaries WHERE TenantId = {tenantId:String})",
          params: { tenantId: "project_a" },
          settings: { [TENANT_IDS_SETTING]: "project_a" },
        }),
      ]);
      expect(divergences).toEqual([{ table: "trace_summaries", returned: 3, enforced: 1 }]);
    });
  });

  describe("when the counts agree", () => {
    /** @scenario "A sampled reader read is re-run as a count under the enforcing identity" */
    it("reports nothing", async () => {
      const enforcing = answering(async () => [{ enforced: 3 }]);
      const { client, divergences, failures, settle } = sampled({ rate: 1, enforcing });

      await client.query(TENANT_READ);
      await settle();

      expect(divergences).toEqual([]);
      expect(failures).toEqual([]);
    });
  });

  describe("when the rate is 0, or the statement is the system's", () => {
    /** @scenario "The shadow sampler is off by default and never touches the read it samples" */
    it("re-runs nothing", async () => {
      const enforcing = answering(async () => [{ enforced: 0 }]);
      const off = sampled({ rate: 0, enforcing });
      const on = sampled({ rate: 1, enforcing });

      await off.client.query(TENANT_READ);
      await on.client.query({
        ...TENANT_READ,
        // The test's own system statement, which the sampler must leave alone.
        SKIP_TENANT_CHECK: true,
      });
      await Promise.all([off.settle(), on.settle()]);

      expect(enforcing.sent).toEqual([]);
      expect(on.system.sent).toHaveLength(1);
    });
  });

  describe("when the re-run fails", () => {
    /** @scenario "The shadow sampler is off by default and never touches the read it samples" */
    it("reports the failure by table and still answers the read", async () => {
      const refusal = new Error("refused");
      const enforcing = answering(async () => {
        throw refusal;
      });
      const { client, failures, divergences, settle } = sampled({ rate: 1, enforcing });

      const result = await client.query(TENANT_READ);
      await settle();

      expect(result.rows).toHaveLength(3);
      expect(failures).toEqual([{ table: "trace_summaries", error: refusal }]);
      expect(divergences).toEqual([]);
    });
  });

  describe("when the rate is outside 0 to 1", () => {
    /** @scenario "A shadow sample rate outside 0 to 1 is refused at construction" */
    it("refuses to construct", () => {
      const enforcing = answering(async () => []);
      for (const rate of [-0.1, 1.5, Number.NaN]) {
        expect(
          () =>
            new ShadowSampler({
              driver: enforcing,
              rate,
              onDivergence: () => undefined,
              onFailure: () => undefined,
            }),
        ).toThrow(RangeError);
      }
    });
  });
});
