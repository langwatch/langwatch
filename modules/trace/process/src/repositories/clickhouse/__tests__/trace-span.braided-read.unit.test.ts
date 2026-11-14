/**
 * The span tree reads braided spans (ADR-201 §3, §5): the condition sits on the outer select,
 * beside the latest-version election, never inside it; each span names an owner that is not
 * the reader. Spec: modules/trace/specs/braided-spans.feature
 */
import type { Authorization, CompiledWhere } from "@langwatch/authorization";
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
const HELD_IN_TRACE =
  /TraceId IN \(SELECT TraceId FROM stored_spans WHERE TenantId IN \(\{tenantScope_own:Array\(String\)\}\) AND StartTime >= fromUnixTimestamp64Milli\(\{tenantScope_heldFrom:Int64\}\) AND TraceId = \{(v\d+):String\}\)/;
const WEB: CompiledWhere = {
  version: 1,
  tree: { kind: "attributeEquals", on: "span", key: "orchestrator", value: "web" },
};

type Row = Record<string, unknown>;
type Sent = { sql: string; params: Record<string, unknown> };

/** The values a statement binds to the parameters `pattern` captures, in order. */
function boundIn({ sent, pattern }: { sent: Sent; pattern: RegExp }): unknown[] {
  const names = pattern.exec(sent.sql)?.slice(1) ?? [];
  if (names.length === 0) throw new Error(`the statement has no ${String(pattern)}`);
  return names.map((name) => sent.params[name ?? ""]);
}

function summaryRow({ spanId, tenantId }: { spanId: string; tenantId?: string }): Row {
  const blank = Object.fromEntries(
    [
      "SpanType",
      "ToolName",
      "Model",
      "ResponseModel",
      "UsageCost",
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
  const statements: Sent[] = [];
  const clickhouse = idIndexedClientDouble({
    indexes: TRACE_ID_INDEXES,
    driver: {
      execute: vi.fn<ScriptedStatements["execute"]>(async (request) => {
        statements.push({ sql: request.sql, params: request.params ?? {} });
        return { rows: request.sql.includes("FROM stored_spans") ? rows : [] };
      }),
    },
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

        const sent = spanRead();
        const { sql, params } = sent;
        const [outer = "", election = ""] = sql.split(LATEST_VERSION);
        expect(outer).toContain("{tenantScope_c0_ids:Array(String)}");
        expect(outer).toContain("SpanAttributes[{tenantScope_p0_k:Array(String)}[1]]");
        expect(boundIn({ sent: { sql: outer, params }, pattern: HELD_IN_TRACE })).toEqual([
          "trace-1",
        ]);
        expect(election).not.toMatch(/tenantScope_[cp]0/);
        expect(sql).not.toContain("'web'");
        expect(params).toMatchObject({
          tenantScope_p0_k: ["orchestrator"],
          tenantScope_p0_v: ["web"],
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
    /tuple\(toUnixTimestamp64Milli\(StartTime\), SpanId, TenantId\) > tuple\(\{(v\d+):Int64\}, \{(v\d+):String\}, \{(v\d+):String\}\)/;
  const SPAN_TUPLE =
    /tuple\(toUnixTimestamp64Milli\(StartTime\), SpanId\) > tuple\(\{(v\d+):Int64\}, \{(v\d+):String\}\)/;
  const CURSOR_START = /StartTime >= fromUnixTimestamp64Milli\(\{(v\d+):Int64\}\) AND tuple\(/;
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
      const sent = await pageAfter({ authorization: braided, ownerProjectId: OWNER });

      expect(boundIn({ sent, pattern: TENANT_TUPLE })).toEqual([
        1_700_000_000_000,
        "shared",
        OWNER,
      ]);
      expect(boundIn({ sent, pattern: CURSOR_START })).toEqual([1_700_000_000_000]);
      expect(sent.sql).toContain("ORDER BY StartTimeMs ASC, SpanId ASC, TenantId ASC");
    });

    /** @scenario "Two projects holding the same span id show both spans" */
    it("places a cursor on the reader's own span in the reader's project", async () => {
      const sent = await pageAfter({ authorization: braided, ownerProjectId: null });

      expect(boundIn({ sent, pattern: TENANT_TUPLE })[2]).toBe(READER);
    });

    it("pages a cursor made before braids by start and span id, as before", async () => {
      const sent = await pageAfter({ authorization: braided });

      expect(boundIn({ sent, pattern: SPAN_TUPLE })).toEqual([1_700_000_000_000, "shared"]);
      expect(sent.sql).not.toMatch(TENANT_TUPLE);
    });
  });

  describe("when the reader holds no braid", () => {
    it("pages by start and span id, naming no tenant", async () => {
      const sent = await pageAfter({
        authorization: ownProof({ projectId: READER }),
        ownerProjectId: null,
      });

      expect(boundIn({ sent, pattern: SPAN_TUPLE })).toEqual([1_700_000_000_000, "shared"]);
      expect(sent.sql).not.toMatch(TENANT_TUPLE);
    });

    /** @scenario "A span tree page past a cursor elects each span's latest version over the whole trace" */
    it("filters the elected spans by the cursor, never the election itself", async () => {
      const { sql } = await pageAfter({ authorization: ownProof({ projectId: READER }) });

      const [outer = "", election = ""] = sql.split(LATEST_VERSION);
      expect(outer).toMatch(SPAN_TUPLE);
      expect(election).not.toContain("tuple(");
      expect(election).not.toMatch(/StartTime >= fromUnixTimestamp64Milli\(\{v\d+:Int64\}\)/);
    });
  });
});

describe("ClickHouseTraceSpanRepository span tree page end", () => {
  const PAGE = 2;
  const spans = (count: number, tenantId?: string) =>
    Array.from({ length: count }, (_, index) =>
      summaryRow({ spanId: `span-${index}`, ...(tenantId === undefined ? {} : { tenantId }) }),
    );

  async function pageOf({ authorization, rows }: { authorization: Authorization; rows: Row[] }) {
    const { repo, spanRead } = treeRepository(rows);
    const page = await repo.listSummaryPage({
      authorization,
      traceId: "trace-1",
      limit: PAGE,
      cursor: { startTimeMs: 1_699_999_999_000, spanId: "a" },
    });
    return { page, sql: spanRead().sql };
  }

  describe("when the reader holds a braid", () => {
    const braided = braidedProof({
      projectId: READER,
      braids: [{ owner: OWNER, compiledWhere: WEB }],
    });

    /** @scenario "A span tree page under a braid reads no span past its end" */
    it("reads no row past the page, so an owner's next span is never read before its audit", async () => {
      const { sql } = await pageOf({ authorization: braided, rows: [] });

      expect(sql).toMatch(new RegExp(` LIMIT ${PAGE}$`));
    });

    /** @scenario "A span tree page under a braid reads no span past its end" */
    it("offers a next page whenever the page is full", async () => {
      const { page } = await pageOf({ authorization: braided, rows: spans(PAGE, READER) });

      expect(page).toMatchObject({ hasMore: true });
      expect(page.rows).toHaveLength(PAGE);
    });

    it("offers no next page when the page is short", async () => {
      const { page } = await pageOf({ authorization: braided, rows: spans(PAGE - 1, READER) });

      expect(page.hasMore).toBe(false);
    });
  });

  describe("when the reader holds no braid", () => {
    const own = ownProof({ projectId: READER });

    it("reads one row past the page to learn whether another follows", async () => {
      const { sql } = await pageOf({ authorization: own, rows: [] });

      expect(sql).toMatch(new RegExp(` LIMIT ${PAGE + 1}$`));
    });

    it("offers no next page when the page is full and nothing follows", async () => {
      const { page } = await pageOf({ authorization: own, rows: spans(PAGE) });

      expect(page.hasMore).toBe(false);
    });

    it("offers a next page when a row follows the page, without returning it", async () => {
      const { page } = await pageOf({ authorization: own, rows: spans(PAGE + 1) });

      expect(page).toMatchObject({ hasMore: true });
      expect(page.rows).toHaveLength(PAGE);
    });
  });
});
