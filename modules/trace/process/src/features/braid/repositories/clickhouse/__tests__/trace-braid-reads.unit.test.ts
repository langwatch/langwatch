/**
 * The braid reads' statements (ADR-201 §7): one proof per statement, the other project only
 * ever a bound parameter, and every key and literal of a condition bound, never in the text.
 * Spec: modules/trace/specs/braided-spans.feature
 */
import type { Authorization, CompiledWhere } from "@langwatch/authorization";
import {
  idIndexedClientDouble,
  type ScriptedStatements,
} from "@langwatch/clickhouse-client/testing";
import { describe, expect, it, vi } from "vitest";

import {
  braidedProof,
  ownProof,
} from "../../../../../__tests__/support/authorization-proofs.fixture.ts";
import { TRACE_ID_INDEXES } from "../../../../../repositories/clickhouse/clickhouse.trace-id-indexes.database.ts";
import { TraceBraidedTotalsService } from "../../../../read/services/trace-braided-totals.service.ts";
import type { BraidActivityRead, BraidWindowRead } from "../../trace-braid-reads.repository.ts";
import { ClickHouseTraceBraidReadsRepository } from "../clickhouse.trace-braid-reads.repository.ts";

const READER = "proj_orchestrator";
const OWNER = "proj_specialists";
const SIGNED_WEB: CompiledWhere = {
  version: 1,
  tree: {
    kind: "and",
    terms: [
      { kind: "attributeEquals", on: "span", key: "orchestrator", value: "web" },
      { kind: "verified", key: "sig" },
    ],
  },
};
const WEB: CompiledWhere = {
  version: 1,
  tree: { kind: "attributeEquals", on: "span", key: "orchestrator", value: "web" },
};

type Statement = { sql: string; params: Record<string, unknown> };

function braidReads(rows: Record<string, unknown>[] = []) {
  const statements: Statement[] = [];
  // The fenced reads and the built reads reach the same recording client.
  const queryClient = idIndexedClientDouble({
    indexes: TRACE_ID_INDEXES,
    driver: {
      execute: vi.fn<ScriptedStatements["execute"]>(async (request) => {
        statements.push({ sql: request.sql, params: request.params ?? {} });
        return { rows: /FROM (stored_spans|trace_summaries)/.test(request.sql) ? rows : [] };
      }),
    },
  });
  const read = (): Statement => {
    const found = statements.find(({ sql }) => /FROM (stored_spans|trace_summaries)/.test(sql));
    if (found === undefined) throw new Error("no braid statement was sent");
    return found;
  };
  return {
    repo: ClickHouseTraceBraidReadsRepository.create({ reader: queryClient }),
    read,
  };
}

/** The projects a statement's fence reads: every project named by a fence parameter. */
function fencedProjects({ params }: Statement): string[] {
  const named = Object.entries(params)
    .filter(([name]) => name.startsWith("tenantScope"))
    .flatMap(([, value]) => (Array.isArray(value) ? value : [value]))
    .filter((value): value is string => value === READER || value === OWNER);
  return [...new Set(named)];
}

/** The values a statement binds under parameters whose generated name ends with `suffix`. */
function boundUnder({ params }: Statement, suffix: string): unknown[] {
  return Object.entries(params)
    .filter(([name]) => name.endsWith(suffix))
    .map(([, value]) => value);
}

/** The epoch-ms instants a statement binds, every window edge and floor among them. */
function boundInstants({ params }: Statement): number[] {
  return Object.values(params)
    .filter((value): value is number => typeof value === "number" && value > 1_000_000_000_000)
    .toSorted((a, b) => a - b);
}

const activityRead = (overrides: Partial<BraidActivityRead> = {}): BraidActivityRead => ({
  braidId: "braid_web",
  ownerProjectId: OWNER,
  readerProjectId: READER,
  compiledWhere: SIGNED_WEB,
  fromMs: 1_700_000_000_000,
  untilMs: 1_700_000_100_000,
  ...overrides,
});

describe("ClickHouseTraceBraidReadsRepository", () => {
  describe("when the preview reads the reader's trace ids", () => {
    it("reads trace_summaries under the reader's proof alone", async () => {
      const { repo, read } = braidReads([{ TraceId: "trace-1" }]);

      const ids = await repo.findReaderTraceIds({
        authorization: ownProof({ projectId: READER }),
        sinceMs: 1_700_000_000_000,
        limit: 10_001,
      });

      expect(ids).toEqual(["trace-1"]);
      expect(read().sql).toContain("FROM trace_summaries");
      expect(fencedProjects(read())).toEqual([READER]);
      expect(read().sql).toContain("LIMIT 10001");
    });
  });

  describe("when the preview counts the owner's spans in those traces", () => {
    const count = async ({
      authorization,
      live = [],
    }: {
      authorization: Authorization;
      live?: BraidWindowRead[];
    }) => {
      const { repo, read } = braidReads([
        {
          every: "3",
          some: "2",
          shownSpans: "11",
          liveEvery: "1",
          liveSome: "1",
          liveSpans: "6",
          unsignedSpans: "4",
          exampleTraceId: "trace-2",
        },
      ]);
      const counts = await repo.countOwnerSpansInTraces({
        authorization,
        traceIds: ["trace-1", "trace-2"],
        sinceMs: 1_699_000_000_000,
        live,
        draft: {
          compiledWhere: SIGNED_WEB,
          readerProjectId: READER,
          fromMs: 1_700_000_000_000,
          untilMs: null,
        },
      });
      return { counts, statement: read() };
    };

    it("fences the owner alone and names the reader only as the bound Verified() value", async () => {
      const { counts, statement } = await count({ authorization: ownProof({ projectId: OWNER }) });

      expect(counts).toEqual({
        shown: { every: 3, some: 2, spans: 11 },
        live: { every: 1, some: 1, spans: 6 },
        unsigned: 4,
        exampleTraceId: "trace-2",
      });
      expect(fencedProjects(statement)).toEqual([OWNER]);
      expect(Object.values(statement.params)).toContainEqual(["trace-1", "trace-2"]);
      expect(boundUnder(statement, "_reader")).toEqual([READER, READER]);
    });

    it("binds every key and literal of the condition, never writing one into the text", async () => {
      const { statement } = await count({ authorization: ownProof({ projectId: OWNER }) });

      expect(statement.sql).not.toMatch(/'(web|orchestrator|sig)'/);
      expect(statement.sql).not.toContain(READER);
      expect(statement.sql).toContain("argMax(");
      expect(boundUnder(statement, "_k")).toContainEqual(expect.arrayContaining(["orchestrator"]));
      expect(boundUnder(statement, "_v")).toContainEqual(["web"]);
    });

    describe("and the reader already has live braids from the owner", () => {
      it("binds each live braid's window and condition apart from the draft's, never merged", async () => {
        const { statement } = await count({
          authorization: ownProof({ projectId: OWNER }),
          live: [
            {
              compiledWhere: WEB,
              readerProjectId: READER,
              fromMs: 1_600_000_000_000,
              untilMs: 1_650_000_000_000,
            },
            {
              compiledWhere: undefined,
              readerProjectId: READER,
              fromMs: 1_660_000_000_000,
              untilMs: null,
            },
          ],
        });

        expect(fencedProjects(statement)).toEqual([OWNER]);
        // Each edge binds once per braid: live1's open end and the draft's bind no upper edge.
        expect(boundInstants(statement)).toEqual([
          1_600_000_000_000, 1_650_000_000_000, 1_660_000_000_000, 1_699_000_000_000,
          1_700_000_000_000, 1_700_000_000_000,
        ]);
        expect(boundUnder(statement, "_v")).toContainEqual(["web"]);
        expect(statement.sql).toMatch(/StartTime < fromUnixTimestamp64Milli\(\{v\d+:Int64\}\)/);
        expect(statement.sql).not.toMatch(/'(web|orchestrator|sig)'/);
        expect(statement.sql).toContain("AS exampleTraceId");
      });
    });
  });

  describe("when the condition editor reads the owner's attribute keys", () => {
    it("leaves the reserved prefix out as a bound parameter under the owner's proof", async () => {
      const { repo, read } = braidReads([{ key: "orchestrator", spanCount: "6" }]);

      const keys = await repo.findAttributeKeys({
        authorization: ownProof({ projectId: OWNER }),
        sinceMs: 1_700_000_000_000,
        limit: 200,
        excludedPrefix: "langwatch.reserved.",
      });

      expect(keys).toEqual([{ key: "orchestrator", spanCount: 6 }]);
      expect(fencedProjects(read())).toEqual([OWNER]);
      expect(read().sql).not.toContain("langwatch.reserved.");
      expect(Object.values(read().params)).toContain("langwatch.reserved.");
      expect(read().sql).toContain("arrayJoin(mapKeys(SpanAttributes))");
      expect(read().sql).toContain("LIMIT 200");
    });
  });

  describe("when the owner's Braids page counts each braid's activity", () => {
    it("reads the owner's own spans with its window and condition bound per braid", async () => {
      const { repo, read } = braidReads([{ a0: "7" }]);

      const counts = await repo.countOwnerBraidActivity({
        authorization: ownProof({ projectId: OWNER }),
        braids: [activityRead()],
        sinceMs: 1_700_000_000_000,
      });

      expect(counts).toEqual(new Map([["braid_web", 7]]));
      expect(fencedProjects(read())).toEqual([OWNER]);
      expect(read().sql).not.toMatch(/'(web|orchestrator|sig)'/);
      expect(boundUnder(read(), "_v")).toEqual([["web"]]);
      expect(boundUnder(read(), "_reader")).toEqual([READER]);
      expect(boundInstants(read())).toEqual([
        1_700_000_000_000, 1_700_000_000_000, 1_700_000_100_000,
      ]);
    });
  });

  describe("when the reader's Braids page counts each braid's activity", () => {
    /** @scenario "A braid's activity counts only spans in traces the reader holds" */
    it("counts owner spans only in traces the reader holds since the same lower bound", async () => {
      const { repo, read } = braidReads([]);

      await repo.countReaderBraidActivity({
        authorization: braidedProof({
          projectId: READER,
          braids: [{ owner: OWNER, compiledWhere: WEB }],
        }),
        braids: [activityRead({ compiledWhere: WEB })],
        sinceMs: 1_700_000_000_000,
      });

      const [outer = ""] = read().sql.split("SELECT TenantId, TraceId, SpanId, max(UpdatedAt)");
      const held = outer.match(
        /TraceId IN \(SELECT TraceId FROM stored_spans WHERE TenantId IN \(\{tenantScope_own:Array\(String\)\}\) AND StartTime >= fromUnixTimestamp64Milli\(\{tenantScope_heldFrom:Int64\}\) AND StartTime >= fromUnixTimestamp64Milli\(\{(v\d+):Int64\}\)\)/,
      );
      expect(held?.[1]).toBeDefined();
      expect(read().params).toMatchObject({
        tenantScope_own: [READER],
        [held?.[1] ?? "unbound"]: 1_700_000_000_000,
      });
    });

    it("reads through the reader's braided fence and attributes each count to its owner", async () => {
      const { repo, read } = braidReads([
        { TenantId: READER, a0: "99" },
        { TenantId: OWNER, a0: "5" },
      ]);

      const counts = await repo.countReaderBraidActivity({
        authorization: braidedProof({
          projectId: READER,
          braids: [{ owner: OWNER, compiledWhere: WEB }],
        }),
        braids: [activityRead({ compiledWhere: WEB })],
        sinceMs: 1_700_000_000_000,
      });

      expect(counts).toEqual(new Map([["braid_web", 5]]));
      expect(read().sql).toContain("{tenantScope_c0_ids:Array(String)}");
      expect(read().sql).not.toMatch(/\{\{tenantScope:|\{\{tenantSet\}\}/);
      expect(read().sql).not.toMatch(/TenantId\s*(=|IN)\s*\{a0/);
      expect(read().sql).not.toMatch(/'(web|orchestrator)'/);
    });
  });

  describe("when a test trace reads the owner's spans in one trace", () => {
    it("selects each span's braided flag under the owner's proof", async () => {
      const { repo, read } = braidReads([]);

      await repo.findOwnerSpansMarked({
        authorization: ownProof({ projectId: OWNER }),
        traceId: "trace-1",
        braids: [
          {
            compiledWhere: WEB,
            readerProjectId: READER,
            fromMs: 1_600_000_000_000,
            untilMs: 1_650_000_000_000,
          },
          { compiledWhere: WEB, readerProjectId: READER, fromMs: 1_700_000_000_000, untilMs: null },
        ],
      });

      expect(read().sql).toContain("AS Braided");
      expect(fencedProjects(read())).toEqual([OWNER]);
      expect(Object.values(read().params)).toContain("trace-1");
      expect(boundUnder(read(), "_v")).toEqual([["web"], ["web"]]);
      expect(boundInstants(read())).toEqual([
        1_600_000_000_000, 1_650_000_000_000, 1_700_000_000_000,
      ]);
      expect(read().sql).not.toContain("'web'");
    });
  });

  describe("when the trace header sums one trace's spans", () => {
    const rows = [
      {
        TenantId: READER,
        HasCost: 0,
        SpanCount: "4",
        StartMs: "1000",
        EndMs: "1500",
        UsageCost: 0,
      },
      {
        TenantId: OWNER,
        HasCost: 1,
        SpanCount: "2",
        StartMs: "1100",
        EndMs: "1900",
        InputTokens: 30,
        OutputTokens: 7,
        UsageCost: 0.2,
      },
      {
        TenantId: OWNER,
        HasCost: 0,
        SpanCount: "1",
        StartMs: "1200",
        EndMs: "1300",
        InputTokens: 10,
        OutputTokens: 5,
        UsageCost: 0,
        Model: "gpt-5-mini",
        ResponseModel: "",
        CacheReadTokens: 3,
      },
    ];

    it("reads through the reader's braided fence, grouped by project, the condition bound", async () => {
      const { repo, read } = braidReads(rows);

      const groups = await repo.sumSpansInTrace({
        authorization: braidedProof({
          projectId: READER,
          braids: [{ owner: OWNER, compiledWhere: WEB }],
        }),
        traceId: "trace-1",
      });

      expect(read().sql).toMatch(/\) GROUP BY TenantId, toFloat64OrZero\(SpanAttributes\[/);
      expect(read().sql).toContain("{tenantScope_c0_ids:Array(String)}");
      expect(read().sql).not.toMatch(/TenantId\s*(=|IN)\s*\{(?!tenantScope)/);
      expect(read().sql).not.toMatch(/'(web|orchestrator)'/);
      expect(read().params).toMatchObject({
        tenantScope_own: [READER],
        tenantScope_c0_ids: [OWNER],
        tenantScope_p0_v: ["web"],
      });
      expect(fencedProjects(read()).toSorted()).toEqual([READER, OWNER].toSorted());
      expect(read().sql).toMatch(/AND TraceId = \{v\d+:String\}\) AND \(\(TenantId IN/);
      expect(groups.filter((group) => group.tenantId === OWNER)).toEqual([
        expect.objectContaining({ spanCount: 2, explicitCost: 0.2, costInput: null }),
        expect.objectContaining({
          spanCount: 1,
          explicitCost: 0,
          costInput: expect.objectContaining({
            model: "gpt-5-mini",
            promptTokens: 10,
            completionTokens: 5,
            attrs: expect.objectContaining({ "gen_ai.usage.cache_read.input_tokens": 3 }),
          }),
        }),
      ]);
    });

    it("sends no statement for a proof without braids", async () => {
      const { repo, read } = braidReads(rows);
      const service = TraceBraidedTotalsService.create({
        reads: repo,
        prices: { estimateCost: () => 0 },
      });

      const totals = await service.ownerTotals({
        authorization: ownProof({ projectId: READER }),
        traceId: "trace-1",
      });

      expect(totals).toEqual([]);
      expect(() => read()).toThrow("no braid statement was sent");
    });
  });
});
