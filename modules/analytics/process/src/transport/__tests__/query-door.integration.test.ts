/**
 * What the `/api/v1/query` door decides before the database is reached: the real service behind
 * the mounted door, over an executor that records what it is asked to run.
 * @see specs/lwql/api.feature
 * @vitest-environment node
 */
import { lwqlResultSchema, type LangWatchQLProtections } from "@langwatch/analytics-contract";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import { GATED_DATASET } from "../../langwatch-ql/__tests__/gatedDatasetFixture.ts";
import {
  LangWatchQLExecutorRepository,
  type LangWatchQLExecutionRequest,
  type LangWatchQLExecutionResult,
} from "../../repositories/langwatch-ql-executor.repository.ts";
import { LWQL_CATALOG, LWQL_VIEW_CATALOG } from "../../rules/lwql-view-catalog.rules.ts";
import { EVERY_CATALOGUE_PERMISSION } from "../../services/__tests__/lwql-catalogue-access.fixture.ts";
import { LangWatchQLService } from "../../services/langwatch-ql.service.ts";
import { mountQueryDoor } from "./query-door.harness.ts";

const DATABASE = "analytics";
const TENANT = { id: "project-a", lwqlKey: "lwql-key-a" };
const PERMITTED: LangWatchQLProtections = {
  catalogue: EVERY_CATALOGUE_PERMISSION,
  canSeeCosts: true,
  canSeeCapturedInput: true,
  canSeeCapturedOutput: true,
};
const ANSWER: LangWatchQLExecutionResult = {
  columns: [
    { name: "TraceId", type: "String" },
    { name: "TotalDurationMs", type: "Int64" },
  ],
  rows: [{ TraceId: "trace-1", TotalDurationMs: "120" }],
  statistics: { elapsedMs: 4, rowsRead: 10, bytesRead: 640, rowsReturned: 1 },
};

/** Answers a fixed result and keeps every request it was handed, in order. */
class RecordingExecutor extends LangWatchQLExecutorRepository {
  readonly requests: LangWatchQLExecutionRequest[] = [];

  execute(request: LangWatchQLExecutionRequest): Promise<LangWatchQLExecutionResult> {
    this.requests.push(request);
    return Promise.resolve(ANSWER);
  }
}

/** The door over the real service, with the gated fixture dataset beside the shipped catalogue. */
function mountDoor({ protections = PERMITTED }: { protections?: LangWatchQLProtections } = {}) {
  const executor = new RecordingExecutor();
  const service = LangWatchQLService.create({
    executor,
    database: DATABASE,
    views: [...LWQL_VIEW_CATALOG, GATED_DATASET],
    catalog: { ...LWQL_CATALOG, [GATED_DATASET.name]: LWQL_CATALOG.traces },
  });
  const door = mountQueryDoor({ tenant: () => TENANT, service: () => service, protections });

  const run = async (request: Record<string, unknown>) => {
    const response = await door.fetch("/api/v1/query", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
    });

    const body: unknown = await response.json();

    return { status: response.status, body };
  };

  return { executor, run };
}

/** The refusal envelope as the caller reads it: code plus the meta the scenarios inspect. */
const refusalSchema = z.object({
  code: z.string(),
  meta: z
    .object({
      parameters: z.array(z.string()).optional(),
      violations: z
        .array(z.object({ code: z.string(), allowedFunctions: z.array(z.string()).optional() }))
        .optional(),
    })
    .optional(),
});

const refusalOf = (body: unknown) => refusalSchema.parse(body);

const violationCodes = (body: unknown) =>
  (refusalOf(body).meta?.violations ?? []).map((violation) => violation.code);

describe("given the query door over the real service", () => {
  describe("when a statement runs", () => {
    /** @scenario "Results carry typed columns, rows, execution statistics, and diagnostics" */
    it("answers typed columns, rows, statistics and diagnostics", async () => {
      const { run } = mountDoor();

      const { status, body } = await run({
        sql: `SELECT TraceId, TotalDurationMs FROM ${DATABASE}.traces LIMIT 5`,
      });

      expect(status).toBe(200);
      const answer = lwqlResultSchema.parse(body);
      expect(answer.columns).toEqual(ANSWER.columns);
      expect(answer.rows).toEqual(ANSWER.rows);
      expect(answer.statistics).toEqual(ANSWER.statistics);
      expect(Array.isArray(answer.diagnostics)).toBe(true);
    });

    /** @scenario "Submitted SQL is never automatically rewritten" */
    it("hands the database the submitted statement byte for byte", async () => {
      const { executor, run } = mountDoor();
      const sql = `SELECT  TraceId,\n   TotalDurationMs\nFROM ${DATABASE}.traces\nWHERE TotalDurationMs > 1 LIMIT 7`;

      await run({ sql });

      expect(executor.requests.map((request) => request.sql)).toEqual([sql]);
    });

    it("appends a default row limit and no other edit when the statement names none", async () => {
      const { executor, run } = mountDoor();
      const sql = `SELECT TraceId FROM ${DATABASE}.traces WHERE TotalDurationMs > 1`;

      await run({ sql });

      const [request] = executor.requests;
      expect(request?.sql.startsWith(sql)).toBe(true);
      expect(request?.sql.slice(sql.length)).toMatch(/^\s*LIMIT \d+\s*$/i);
    });
  });

  describe("when a bound parameter has no value", () => {
    const sql = `SELECT TraceId FROM ${DATABASE}.traces WHERE TraceId = {traceId:String} AND TotalDurationMs > {minMs:UInt32} LIMIT 5`;

    /** @scenario "A parameterized query missing a bound value is refused before execution" */
    it("refuses at 400 naming every unset parameter, and never reaches the database", async () => {
      const { executor, run } = mountDoor();

      const none = await run({ sql });
      const one = await run({ sql, parameters: { traceId: "trace-1" } });

      expect(none.status).toBe(400);
      expect(refusalOf(none.body).code).toBe("lwql_parameter_missing");
      expect(refusalOf(none.body).meta?.parameters).toEqual(["minMs", "traceId"]);
      expect(one.status).toBe(400);
      expect(refusalOf(one.body).meta?.parameters).toEqual(["minMs"]);
      expect(executor.requests).toEqual([]);
    });

    it("runs once every declared parameter carries a value", async () => {
      const { executor, run } = mountDoor();

      const { status } = await run({ sql, parameters: { traceId: "trace-1", minMs: 5 } });

      expect(status).toBe(200);
      expect(executor.requests.map((request) => request.parameters)).toEqual([
        { traceId: "trace-1", minMs: 5 },
      ]);
    });
  });

  describe("when a table function is named", () => {
    /** @scenario "External and table-function access is blocked by AST policy before reaching the database" */
    it.each([
      ["postgresql", "SELECT * FROM postgresql('h:5432', 'db', 'tbl', 'u', 'p')"],
      ["url", "SELECT * FROM url('http://169.254.169.254/', CSV)"],
      ["s3", "SELECT * FROM s3('https://bucket/k', 'CSV')"],
      ["remote", "SELECT * FROM remote('other-host', 'db', 'tbl')"],
      ["numbers", "SELECT * FROM numbers(10)"],
    ])("refuses %s at 400 under the TABLE_FUNCTION rule", async (_name, sql) => {
      const { executor, run } = mountDoor();

      const { status, body } = await run({ sql });

      expect(status).toBe(400);
      expect(refusalOf(body).code).toBe("lwql_not_permitted");
      expect(violationCodes(body)).toContain("TABLE_FUNCTION");
      expect(executor.requests).toEqual([]);
    });
  });

  describe("when a view is withheld from the caller", () => {
    const sql = `SELECT TranscriptId FROM ${DATABASE}.${GATED_DATASET.name} LIMIT 5`;

    /** @scenario "A view withheld from a caller cannot be named in a query" */
    it("refuses the query before the database, while a caller holding the permission reads it", async () => {
      const withheld = mountDoor({ protections: { ...PERMITTED, canSeeCapturedInput: false } });
      const held = mountDoor();

      const refused = await withheld.run({ sql });
      const read = await held.run({ sql });

      expect(refused.status).toBe(400);
      expect(refusalOf(refused.body).code).toBe("lwql_not_permitted");
      expect(violationCodes(refused.body)).toContain("TABLE_NOT_ALLOWED");
      expect(withheld.executor.requests).toEqual([]);
      expect(read.status).toBe(200);
      expect(held.executor.requests).toHaveLength(1);
    });
  });

  describe("when a disallowed function is called", () => {
    /** @scenario "The REST caller receives allowedFunctions on a function violation" */
    it("carries the complete allowlist on the violation the caller reads", async () => {
      const { executor, run } = mountDoor();

      const { status, body } = await run({
        sql: `SELECT currentUser() AS who FROM ${DATABASE}.traces LIMIT 1`,
      });

      const violation = (refusalOf(body).meta?.violations ?? []).find(
        (entry) => entry.code === "FUNCTION_NOT_ALLOWED",
      );
      const allowed = violation?.allowedFunctions ?? [];
      expect(status).toBe(400);
      expect(allowed.length).toBeGreaterThan(0);
      expect(allowed).toEqual(
        allowed.toSorted((a, b) => a.toLowerCase().localeCompare(b.toLowerCase())),
      );
      expect(new Set(allowed).size).toBe(allowed.length);
      expect(executor.requests).toEqual([]);
    });
  });
});
