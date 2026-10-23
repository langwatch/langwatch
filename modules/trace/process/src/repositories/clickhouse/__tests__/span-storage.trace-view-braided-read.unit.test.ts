/**
 * The trace view's span reads under braids (ADR-185 §3, §5): the condition sits on the outer
 * select beside a bare latest-version election, every value bound. Without braids, or for a read
 * that does not ask for `spans`, the statement is the one sent before. Spec: braided-spans.feature
 */
import type { Authorization, CompiledWhere } from "@langwatch/authorization";
import { AuthorizedClickHouse } from "@langwatch/clickhouse-client";
import {
  idIndexedClientDouble,
  type ScriptedStatements,
} from "@langwatch/clickhouse-client/testing";
import { describe, expect, it, vi } from "vitest";

import { braidedProof, ownProof } from "../../../__tests__/support/authorization-proofs.fixture.ts";
import type { TraceViewRead } from "../../span-storage.repository.ts";
import { TRACE_ID_INDEXES } from "../clickhouse.trace-id-indexes.database.ts";
import { SpanStorageClickHouseRepository } from "../span-storage.repository.ts";

const READER = "proj_orchestrator";
const OWNER = "proj_specialists";
const LATEST_VERSION = "SELECT TenantId, TraceId, SpanId, max(UpdatedAt)";
const WEB: CompiledWhere = {
  version: 1,
  tree: { kind: "attributeEquals", on: "span", key: "orchestrator", value: "web" },
};

type Statement = { sql: string; params: Record<string, unknown> };

function spanRepository() {
  const statements: Statement[] = [];
  const clickhouse = new AuthorizedClickHouse({
    resolveClient: async () =>
      idIndexedClientDouble({
        indexes: TRACE_ID_INDEXES,
        driver: {
          execute: vi.fn<ScriptedStatements["execute"]>(async (request) => {
            statements.push({ sql: request.sql, params: request.params ?? {} });
            const counts = request.sql.includes("AS Total");
            return { rows: counts ? [{ Total: 1, FromMs: 1, ToMs: 2 }] : [] };
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

type Read = (
  repo: SpanStorageClickHouseRepository,
  input: { authorization: Authorization } & TraceViewRead,
) => Promise<unknown>;

const at = { traceId: "trace-1", occurredAtMs: 1_700_000_000_000 };
const reads: Record<string, Read> = {
  spansPaginated: (repo, input) =>
    repo.listSpansPaginated({ ...input, ...at, limit: 50, offset: 0 }),
  spansDelta: (repo, input) => repo.findSpansSince({ ...input, ...at, sinceStartTimeMs: 1 }),
  spansFull: (repo, input) => repo.findSpansByTraceId({ ...input, ...at }),
  spansFullResolved: (repo, input) => repo.findNormalizedSpansByTraceId({ ...input, ...at }),
  spanTree: (repo, input) => repo.findSpanSummaryByTraceId({ ...input, ...at }),
  spanLangwatchSignals: (repo, input) => repo.findLangwatchSignalsByTraceId({ ...input, ...at }),
  resourceInfo: (repo, input) => repo.findSpanResourcesByTraceId({ ...input, ...at }),
  traceEvents: (repo, input) => repo.findTraceEventsByTraceId({ ...input, ...at }),
};

async function statementsOf({
  read,
  authorization,
  reads: resource,
}: {
  read: Read;
  authorization: Authorization;
  reads?: TraceViewRead["reads"];
}): Promise<Statement[]> {
  const { repo, spanReads } = spanRepository();
  await read(repo, { authorization, ...(resource === undefined ? {} : { reads: resource }) });
  return spanReads();
}

describe("SpanStorageClickHouseRepository trace-view reads", () => {
  describe.each(Object.entries(reads))("given the %s read", (_name, read) => {
    describe("when the reader holds a braid with a condition and the view reads spans", () => {
      const authorization = braidedProof({
        projectId: READER,
        braids: [{ owner: OWNER, compiledWhere: WEB }],
      });

      /** @scenario "Every view of the trace shows the same braided spans" */
      it("applies the condition on the outer select of every statement and binds its values", async () => {
        const statements = await statementsOf({ read, authorization, reads: "spans" });

        expect(statements.length).toBeGreaterThan(0);
        for (const { sql, params } of statements) {
          const [outer = "", election = ""] = sql.split(LATEST_VERSION);
          expect(outer).toContain("{tenantScope_c0_ids:Array(String)}");
          expect(outer).toContain("SpanAttributes[{tenantScope_c0_0k:String}]");
          expect(election).not.toContain("tenantScope_c0");
          expect(sql).not.toContain("'web'");
          expect(sql).not.toContain("orchestrator");
          expect(params).toMatchObject({
            tenantScope_c0_0k: "orchestrator",
            tenantScope_c0_0v: "web",
          });
        }
      });

      it("names no tenant of its own", async () => {
        const statements = await statementsOf({ read, authorization, reads: "spans" });

        for (const { sql } of statements) expect(sql).not.toContain(OWNER);
      });
    });

    describe("when the reader holds no braid", () => {
      it("sends exactly the statement a read that does not ask for spans sends", async () => {
        const authorization = ownProof({ projectId: READER });

        expect(await statementsOf({ read, authorization, reads: "spans" })).toEqual(
          await statementsOf({ read, authorization }),
        );
      });
    });

    describe("when the reader holds a braid but the read does not ask for spans", () => {
      it("sends the reader's own statement, with no condition", async () => {
        const braided = braidedProof({
          projectId: READER,
          braids: [{ owner: OWNER, compiledWhere: WEB }],
        });
        const own = await statementsOf({ read, authorization: ownProof({ projectId: READER }) });
        const statements = await statementsOf({ read, authorization: braided });

        expect(statements.map(({ sql }) => sql)).toEqual(own.map(({ sql }) => sql));
        for (const { sql } of statements) expect(sql).not.toContain("tenantScope_c");
      });
    });
  });
});
