/**
 * Load-bearing SR-1 proof for the read-only trace query compiler (SPIKE #5670).
 *
 * Seeds TWO tenants into a real ClickHouse, gives the foreign tenant a
 * distinguishable model, then runs an adversarial corpus as the first tenant
 * and proves ZERO foreign rows are ever returned — while a control query
 * confirms the foreign data really is present in the DB (so the exclusion is
 * the compiler's tenant scoping, not missing data).
 *
 * This is the executed proof CODING_STANDARDS demands for a security bug: it
 * runs the code path and observes the isolation, not just the SQL string.
 *
 * @see specs/trace-query/read-only-query-surface.feature (SR-1 @integration)
 */

import type { ClickHouseClient } from "@clickhouse/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  cleanupTestData,
  getTestClickHouseClient,
} from "../../../../event-sourcing/__tests__/integration/testContainers";
import { seedSpans } from "../../../../analytics/clickhouse/__tests__/test-utils/clickhouse-fixtures";
import { compileTraceQuery } from "../compile";
import { executeTraceQuery } from "../execute";
import type { TraceQueryRequest } from "../schema";

const ACME = "acme-5670";
const GLOBEX = "globex-5670";
const ACME_MODEL = "acme-model";
const GLOBEX_MODEL = "globex-secret-model";
const ACME_TRACES = 5;
const GLOBEX_TRACES = 3;

const now = Date.now();
const timeRange = { from: now - 90 * 24 * 60 * 60 * 1000, to: now + 24 * 60 * 60 * 1000 };

describe("trace-query compiler — cross-tenant isolation (SR-1)", () => {
  let ch: ClickHouseClient;

  async function run(request: TraceQueryRequest, tenantId: string) {
    const { sql, params } = compileTraceQuery({ request, tenantId });
    const result = await ch.query({
      query: sql,
      query_params: params,
      format: "JSONEachRow",
    });
    return result.json<Record<string, unknown>>();
  }

  beforeAll(async () => {
    const client = getTestClickHouseClient();
    if (!client) throw new Error("ClickHouse test client not available");
    ch = client;

    await seedSpans(ch, {
      tenantId: ACME,
      count: ACME_TRACES,
      attributeKeys: 3,
      traceCount: ACME_TRACES,
      models: [ACME_MODEL],
    });
    await seedSpans(ch, {
      tenantId: GLOBEX,
      count: GLOBEX_TRACES,
      attributeKeys: 3,
      traceCount: GLOBEX_TRACES,
      models: [GLOBEX_MODEL],
    });
  }, 120_000);

  afterAll(async () => {
    await cleanupTestData(ACME);
    await cleanupTestData(GLOBEX);
  });

  describe("given both tenants' data is present in the store", () => {
    // Control: without this, a passing isolation test could be a false
    // positive (foreign data simply absent). This proves it is present.
    it("confirms the foreign tenant's rows really exist in ClickHouse", async () => {
      const raw = await ch.query({
        query: `SELECT count() AS c FROM trace_summaries WHERE TenantId = {t:String}`,
        query_params: { t: GLOBEX },
        format: "JSONEachRow",
      });
      const [row] = await raw.json<{ c: string }>();
      expect(Number(row?.c)).toBe(GLOBEX_TRACES);
    });
  });

  describe("when tenant acme runs count() grouped by model", () => {
    it("returns only its own model bucket, never the foreign model", async () => {
      const rows = await run(
        { aggregations: [{ op: "count", alias: "c" }], groupBy: ["model"], timeRange },
        ACME,
      );
      const models = rows.map((r) => String(r.model));
      expect(models).toContain(ACME_MODEL);
      expect(models).not.toContain(GLOBEX_MODEL);
    });

    it("counts only its own traces (a leak would inflate the total)", async () => {
      const rows = await run(
        { aggregations: [{ op: "count", alias: "c" }], timeRange },
        ACME,
      );
      const total = rows.reduce((s, r) => s + Number(r.c), 0);
      expect(total).toBe(ACME_TRACES); // NOT ACME_TRACES + GLOBEX_TRACES
    });
  });

  describe("when tenant acme runs p95 latency by model", () => {
    it("produces a bucket for its own model only", async () => {
      const rows = await run(
        {
          aggregations: [{ op: "p95", column: "durationMs", alias: "p95_latency" }],
          groupBy: ["model"],
          timeRange,
        },
        ACME,
      );
      expect(rows.every((r) => String(r.model) === ACME_MODEL)).toBe(true);
      expect(rows.length).toBe(1);
    });
  });

  describe("when hostile filter text tries to widen the tenant scope", () => {
    it("still returns only acme rows (the payload is bound as data)", async () => {
      const rows = await run(
        {
          aggregations: [{ op: "count", alias: "c" }],
          groupBy: ["model"],
          filter: `"' OR TenantId = '${GLOBEX}' OR '1'='1"`,
          timeRange,
        },
        ACME,
      );
      expect(rows.map((r) => String(r.model))).not.toContain(GLOBEX_MODEL);
    });
  });

  describe("when a span-attribute filter creates a tenant-scoped subquery", () => {
    it("never matches the foreign tenant's traces", async () => {
      const rows = await run(
        {
          aggregations: [{ op: "count", alias: "c" }],
          groupBy: ["model"],
          filter: "span.attribute.langwatch.span.type:llm",
          timeRange,
        },
        ACME,
      );
      expect(rows.map((r) => String(r.model))).not.toContain(GLOBEX_MODEL);
    });
  });

  describe("given SR-2: an independent read-only execution layer", () => {
    it("refuses a write issued under readonly=1 (grammar-independent guard)", async () => {
      await expect(
        ch.command({
          query: `INSERT INTO trace_summaries (TenantId, TraceId) VALUES ('${ACME}', 'x')`,
          clickhouse_settings: { readonly: "1" },
        }),
      ).rejects.toThrow();
    });
  });

  describe("when running the full compile → execute path", () => {
    it("returns only the caller's rows and audits a redacted query shape", async () => {
      const compiled = compileTraceQuery({
        request: {
          aggregations: [{ op: "count", alias: "c" }],
          groupBy: ["model"],
          filter: "cost:>0.001",
          timeRange,
        },
        tenantId: ACME,
      });
      const { rows, audit } = await executeTraceQuery({
        compiled,
        client: ch,
        tenantId: ACME,
        caller: "integration-test",
      });

      expect(rows.map((r) => String(r.model))).not.toContain(GLOBEX_MODEL);
      // Audit records a shape + hash, with the literal filter value stripped.
      expect(audit.sha256).toMatch(/^[0-9a-f]{16}$/);
      expect(audit.shape).not.toContain("0.001");
    });
  });
});
