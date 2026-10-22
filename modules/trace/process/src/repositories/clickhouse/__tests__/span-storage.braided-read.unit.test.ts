/**
 * The span panel reads one braided span (ADR-183 §3, §5): the owner named, the condition on the
 * outer select beside the latest-version election, never inside it. A read without braids sends
 * the statement it sent before. Spec: modules/trace/specs/braided-spans.feature
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
import { SpanStorageClickHouseRepository } from "../span-storage.repository.ts";

const READER = "proj_orchestrator";
const OWNER = "proj_specialists";
const LATEST_VERSION = "SELECT TenantId, TraceId, SpanId, max(UpdatedAt)";
const WEB: CompiledWhere = {
  version: 1,
  tree: { kind: "attributeEquals", on: "span", key: "orchestrator", value: "web" },
};

function spanRepository(rows: Record<string, unknown>[] = []) {
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
  const repo = SpanStorageClickHouseRepository.create({
    resolveClient: async () => {
      throw new Error("this test writes nothing");
    },
    clickhouse,
  });
  const spanReads = () => statements.filter(({ sql }) => sql.includes("FROM stored_spans"));
  return { repo, spanReads };
}

const reads = {
  span: (
    repo: SpanStorageClickHouseRepository,
    authorization: Authorization,
    ownerProjectId?: string,
  ) =>
    repo.findSpanByIds({
      authorization,
      traceId: "trace-1",
      spanId: "span-1",
      ownerProjectId,
      occurredAtMs: 1_700_000_000_000,
    }),
  events: (
    repo: SpanStorageClickHouseRepository,
    authorization: Authorization,
    ownerProjectId?: string,
  ) =>
    repo.findSpanEvents({
      authorization,
      traceId: "trace-1",
      spanId: "span-1",
      ownerProjectId,
      occurredAtMs: 1_700_000_000_000,
    }),
};

describe("SpanStorageClickHouseRepository braided span events", () => {
  describe("when two projects hold the selected span id and the owner's span is selected", () => {
    /** @scenario "Two projects holding the same span id show both spans" */
    it("keeps the owner's events and drops the reader's", async () => {
      const event = (projectId: string) => ({
        event_id: "span-1",
        trace_id: "trace-1",
        project_id: projectId,
        started_at: 1_700_000_000_000,
        event_type: projectId,
        attributes: {},
      });
      const { repo } = spanRepository([event(READER), event(OWNER)]);

      const events = await repo.findSpanEvents({
        authorization: braidedProof({ projectId: READER, braids: [{ owner: OWNER }] }),
        traceId: "trace-1",
        spanId: "span-1",
        ownerProjectId: OWNER,
        occurredAtMs: 1_700_000_000_000,
      });

      expect(events.map((read) => read.project_id)).toEqual([OWNER]);
    });
  });
});

describe("SpanStorageClickHouseRepository braided single-span reads", () => {
  describe.each(Object.entries(reads))("given the span panel's %s read", (_name, read) => {
    describe("when the reader holds a braid and selects the owner's span", () => {
      const authorization = braidedProof({
        projectId: READER,
        braids: [{ owner: OWNER, compiledWhere: WEB }],
      });

      it("applies the condition on the outer select only, naming no tenant of its own", async () => {
        const { repo, spanReads } = spanRepository();

        await read(repo, authorization, OWNER);

        const [statement] = spanReads();
        const [outer = "", election = ""] = statement?.sql.split(LATEST_VERSION) ?? [];
        expect(outer).toContain("{tenantScope_c0_ids:Array(String)}");
        expect(election).not.toContain("tenantScope_c0");
        expect(statement?.sql).not.toMatch(/ORDER BY UpdatedAt DESC\s+LIMIT 1/);
        expect(statement?.params).toMatchObject({
          tenantScope_c0_0k: "orchestrator",
          tenantScope_c0_0v: "web",
        });
      });
    });

    describe("when the reader holds no braid", () => {
      it("sends the statement it sent before braids", async () => {
        const { repo, spanReads } = spanRepository();

        await read(repo, ownProof({ projectId: READER }));

        const [statement] = spanReads();
        expect(statement?.sql).toMatch(/ORDER BY UpdatedAt DESC\s+LIMIT 1/);
        expect(statement?.sql).not.toContain("tenantScope_c");
        expect(statement?.sql).not.toContain("ownerProjectId");
      });

      it("reads nothing for a span another project owns", async () => {
        const { repo, spanReads } = spanRepository();

        const result = await read(repo, ownProof({ projectId: READER }), OWNER);

        expect(spanReads()).toHaveLength(0);
        expect(result === null || (Array.isArray(result) && result.length === 0)).toBe(true);
      });
    });
  });
});
