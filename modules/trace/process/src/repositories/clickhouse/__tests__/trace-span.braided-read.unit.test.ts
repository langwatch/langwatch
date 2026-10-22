/**
 * The span tree reads braided spans (ADR-183 §3, §5): the condition sits on the outer select,
 * beside the latest-version election, never inside it; each span names an owner that is not
 * the reader. Spec: modules/trace/specs/braided-spans.feature
 */
import type { Authorization, CompiledWhere } from "@langwatch/authorization";
import { AuthorizedClickHouse } from "@langwatch/clickhouse-client";
import {
  idIndexedClientDouble,
  type ScriptedStatements,
} from "@langwatch/clickhouse-client/testing";
import { describe, expect, it, vi } from "vitest";

import { braidedProof, ownProof } from "../../../__tests__/support/authorization-proofs.fixture.ts";
import { TRACE_ID_INDEXES } from "../clickhouse.trace-id-indexes.database.ts";
import { ClickHouseTraceSpanRepository } from "../trace-span.repository.ts";

const READER = "proj_orchestrator";
const OWNER = "proj_specialists";
const LATEST_VERSION = "SELECT TenantId, TraceId, SpanId, max(UpdatedAt)";
const WEB: CompiledWhere = {
  version: 1,
  tree: { kind: "attributeEquals", on: "span", key: "orchestrator", value: "web" },
};

type Row = Record<string, unknown>;

function summaryRow({ spanId, tenantId }: { spanId: string; tenantId?: string }): Row {
  const blank = Object.fromEntries(
    [
      "SpanType",
      "ToolName",
      "Model",
      "ResponseModel",
      "Cost",
      "InputTokens",
      "OutputTokens",
      "CacheReadTokens",
      "CacheCreationTokens",
      "CacheCreation1hTokens",
      "InputChars",
      "AudioSeconds",
      "InputAudioTokens",
      "OutputAudioTokens",
      "CustomInputRate",
      "CustomOutputRate",
      "CustomCacheReadRate",
      "CustomCacheCreationRate",
      "CustomCacheCreation1hRate",
      "LwSpanCost",
    ].map((column) => [column, ""]),
  );
  return {
    ...blank,
    SpanId: spanId,
    ParentSpanId: null,
    SpanName: "agent",
    StartTimeMs: 1_700_000_000_000,
    DurationMs: 10,
    UpdatedAtMs: 1_700_000_000_010,
    StatusCode: 1,
    ...(tenantId === undefined ? {} : { TenantId: tenantId }),
  };
}

function treeRepository(rows: Row[]) {
  const statements: { sql: string; params: Record<string, unknown> }[] = [];
  const clickhouse = new AuthorizedClickHouse({
    resolveClient: async () =>
      idIndexedClientDouble({
        indexes: TRACE_ID_INDEXES,
        driver: {
          execute: vi.fn<ScriptedStatements["execute"]>(async (request) => {
            statements.push({ sql: request.sql, params: request.params ?? {} });
            return { rows: request.sql.includes("FROM stored_spans") ? rows : [] };
          }),
        },
      }),
  });
  const spanRead = () => {
    const read = statements.find((statement) => statement.sql.includes("FROM stored_spans"));
    if (read === undefined) throw new Error("no span statement was sent");
    return read;
  };
  return { repo: ClickHouseTraceSpanRepository.create({ clickhouse }), spanRead };
}

const reads = {
  page: (repo: ClickHouseTraceSpanRepository, authorization: Authorization) =>
    repo.listSummaryPage({
      authorization,
      traceId: "trace-1",
      limit: 50,
      cursor: { startTimeMs: 1_699_999_999_000, spanId: "a" },
    }),
  delta: (repo: ClickHouseTraceSpanRepository, authorization: Authorization) =>
    repo.findSummarySince({
      authorization,
      traceId: "trace-1",
      sinceUpdatedAtMs: 1_699_999_999_000,
      occurredAtMs: 1_700_000_000_000,
    }),
};

describe("ClickHouseTraceSpanRepository braided reads", () => {
  describe.each(Object.entries(reads))("given the tree's %s read", (_name, read) => {
    describe("when the reader holds a braid with a condition", () => {
      const authorization = braidedProof({
        projectId: READER,
        braids: [{ owner: OWNER, compiledWhere: WEB }],
      });

      /** @scenario "The condition is applied to each span's latest version" */
      it("applies the condition on the outer select and leaves the latest-version election bare", async () => {
        const { repo, spanRead } = treeRepository([]);

        await read(repo, authorization);

        const { sql, params } = spanRead();
        const [outer = "", election = ""] = sql.split(LATEST_VERSION);
        expect(outer).toContain("{tenantScope_c0_ids:Array(String)}");
        expect(outer).toContain("SpanAttributes[{tenantScope_c0_0k:String}]");
        expect(election).not.toContain("tenantScope_c0");
        expect(sql).not.toContain("'web'");
        expect(params).toMatchObject({
          tenantScope_c0_0k: "orchestrator",
          tenantScope_c0_0v: "web",
        });
      });

      /** @scenario "Two projects holding the same span id show both spans" */
      it("returns both spans of one span id, naming the owner on the one it does not hold", async () => {
        const { repo } = treeRepository([
          summaryRow({ spanId: "shared", tenantId: READER }),
          summaryRow({ spanId: "shared", tenantId: OWNER }),
        ]);

        const result = await read(repo, authorization);
        const nodes = "rows" in result ? result.rows : result;

        expect(nodes.map((node) => [node.spanId, node.ownerProjectId])).toEqual([
          ["shared", undefined],
          ["shared", OWNER],
        ]);
      });

      /** @scenario "Nothing hints at owner spans that were not braided" */
      it("returns exactly the spans read, with no stand-in for spans that did not match", async () => {
        const { repo } = treeRepository([summaryRow({ spanId: "own", tenantId: READER })]);

        const result = await read(repo, authorization);
        const nodes = "rows" in result ? result.rows : result;

        expect(nodes).toHaveLength(1);
        expect(nodes[0]).not.toHaveProperty("ownerProjectId");
      });
    });

    describe("when the reader holds no braid", () => {
      it("sends the statement it sent before braids, selecting no owner", async () => {
        const { repo, spanRead } = treeRepository([summaryRow({ spanId: "own" })]);

        const result = await read(repo, ownProof({ projectId: READER }));
        const nodes = "rows" in result ? result.rows : result;

        const { sql } = spanRead();
        expect(sql).not.toMatch(/,\s*TenantId\s+FROM/);
        expect(sql).not.toContain("tenantScope_c");
        expect(nodes[0]).not.toHaveProperty("ownerProjectId");
      });
    });
  });
});

describe("ClickHouseTraceSpanRepository span tree cursor", () => {
  const TENANT_TUPLE =
    "(toUnixTimestamp64Milli(StartTime), SpanId, TenantId) > ({cursorStart:Int64}, {cursorSpan:String}, {cursorTenant:String})";
  const SPAN_TUPLE =
    "(toUnixTimestamp64Milli(StartTime), SpanId) > ({cursorStart:Int64}, {cursorSpan:String})";
  const braided = braidedProof({
    projectId: READER,
    braids: [{ owner: OWNER, compiledWhere: WEB }],
  });

  async function pageAfter({
    authorization,
    ownerProjectId,
  }: {
    authorization: Authorization;
    ownerProjectId?: string | null;
  }) {
    const { repo, spanRead } = treeRepository([]);
    await repo.listSummaryPage({
      authorization,
      traceId: "trace-1",
      limit: 1,
      cursor: {
        startTimeMs: 1_700_000_000_000,
        spanId: "shared",
        ...(ownerProjectId === undefined ? {} : { ownerProjectId }),
      },
    });
    return spanRead();
  }

  describe("when the reader holds a braid", () => {
    /** @scenario "Two projects holding the same span id show both spans" */
    it("starts after the owner's span, so the reader's span of that id is its own position", async () => {
      const { sql, params } = await pageAfter({ authorization: braided, ownerProjectId: OWNER });

      expect(sql).toContain(TENANT_TUPLE);
      expect(sql).toContain("AND StartTime >= fromUnixTimestamp64Milli({cursorStart:Int64})");
      expect(sql).toContain("ORDER BY StartTimeMs ASC, SpanId ASC, TenantId ASC");
      expect(params).toMatchObject({ cursorSpan: "shared", cursorTenant: OWNER });
    });

    /** @scenario "Two projects holding the same span id show both spans" */
    it("places a cursor on the reader's own span in the reader's project", async () => {
      const { sql, params } = await pageAfter({ authorization: braided, ownerProjectId: null });

      expect(sql).toContain(TENANT_TUPLE);
      expect(params).toMatchObject({ cursorTenant: READER });
    });

    it("pages a cursor made before braids by start and span id, as before", async () => {
      const { sql, params } = await pageAfter({ authorization: braided });

      expect(sql).toContain(SPAN_TUPLE);
      expect(params).not.toHaveProperty("cursorTenant");
    });
  });

  describe("when the reader holds no braid", () => {
    it("pages by start and span id, naming no tenant", async () => {
      const { sql, params } = await pageAfter({
        authorization: ownProof({ projectId: READER }),
        ownerProjectId: null,
      });

      expect(sql).toContain(SPAN_TUPLE);
      expect(params).not.toHaveProperty("cursorTenant");
    });
  });
});
