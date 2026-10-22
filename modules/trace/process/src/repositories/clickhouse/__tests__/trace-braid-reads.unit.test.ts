/**
 * The braid reads' statements (ADR-183 §7): one proof per statement, the other project only
 * ever a bound parameter, and every key and literal of a condition bound, never in the text.
 * Spec: modules/trace/specs/braided-spans.feature
 */
import type { Authorization, CompiledWhere } from "@langwatch/authorization";
import { AuthorizedClickHouse } from "@langwatch/clickhouse-client";
import {
  idIndexedClientDouble,
  type ScriptedStatements,
} from "@langwatch/clickhouse-client/testing";
import { describe, expect, it, vi } from "vitest";

import { braidedProof, ownProof } from "../../../__tests__/support/authorization-proofs.fixture.ts";
import type { BraidActivityRead } from "../../trace-braid-reads.repository.ts";
import { TRACE_ID_INDEXES } from "../clickhouse.trace-id-indexes.database.ts";
import { ClickHouseTraceBraidReadsRepository } from "../trace-braid-reads.repository.ts";

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
  const clickhouse = new AuthorizedClickHouse({
    resolveClient: async () =>
      idIndexedClientDouble({
        indexes: TRACE_ID_INDEXES,
        driver: {
          execute: vi.fn<ScriptedStatements["execute"]>(async (request) => {
            statements.push({ sql: request.sql, params: request.params ?? {} });
            return { rows: /FROM (stored_spans|trace_summaries)/.test(request.sql) ? rows : [] };
          }),
        },
      }),
  });
  const read = (): Statement => {
    const found = statements.find(({ sql }) => /FROM (stored_spans|trace_summaries)/.test(sql));
    if (found === undefined) throw new Error("no braid statement was sent");
    return found;
  };
  return { repo: ClickHouseTraceBraidReadsRepository.create({ clickhouse }), read };
}

/** The projects a statement's fence reads: every project named by a fence parameter. */
function fencedProjects({ params }: Statement): string[] {
  const named = Object.entries(params)
    .filter(([name]) => name.startsWith("tenantScope"))
    .flatMap(([, value]) => (Array.isArray(value) ? value : [value]))
    .filter((value): value is string => value === READER || value === OWNER);
  return [...new Set(named)];
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
      expect(read().params).toMatchObject({ limit: 10_001 });
    });
  });

  describe("when the preview counts the owner's spans in those traces", () => {
    const count = async (authorization: Authorization) => {
      const { repo, read } = braidReads([{ every: "3", some: "2", unsigned: "4" }]);
      const counts = await repo.countOwnerSpansInTraces({
        authorization,
        traceIds: ["trace-1", "trace-2"],
        sinceMs: 1_699_000_000_000,
        fromMs: 1_700_000_000_000,
        condition: { compiledWhere: SIGNED_WEB, readerProjectId: READER },
      });
      return { counts, statement: read() };
    };

    it("fences the owner alone and names the reader only as the bound Verified() value", async () => {
      const { counts, statement } = await count(ownProof({ projectId: OWNER }));

      expect(counts).toEqual({ every: 3, some: 2, unsigned: 4 });
      expect(fencedProjects(statement)).toEqual([OWNER]);
      expect(statement.params).toMatchObject({
        traceIds: ["trace-1", "trace-2"],
        braid_reader: READER,
        braidSigned_reader: READER,
      });
    });

    it("binds every key and literal of the condition, never writing one into the text", async () => {
      const { statement } = await count(ownProof({ projectId: OWNER }));

      expect(statement.sql).not.toMatch(/'(web|orchestrator|sig)'/);
      expect(statement.sql).not.toContain(READER);
      expect(statement.sql).toContain("argMax(");
      expect(statement.params).toMatchObject({ braid_0k: "orchestrator", braid_0v: "web" });
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
      expect(read().params).toMatchObject({ excludedPrefix: "langwatch.reserved.", limit: 200 });
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
      expect(read().params).toMatchObject({
        a0_0v: "web",
        a0_reader: READER,
        a0_fromMs: 1_700_000_000_000,
        a0_untilMs: 1_700_000_100_000,
      });
    });
  });

  describe("when the reader's Braids page counts each braid's activity", () => {
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
        fromMs: 1_700_000_000_000,
        condition: { compiledWhere: WEB, readerProjectId: READER },
      });

      expect(read().sql).toContain("AS Braided");
      expect(fencedProjects(read())).toEqual([OWNER]);
      expect(read().params).toMatchObject({ traceId: "trace-1", braid_0v: "web" });
      expect(read().sql).not.toContain("'web'");
    });
  });
});
