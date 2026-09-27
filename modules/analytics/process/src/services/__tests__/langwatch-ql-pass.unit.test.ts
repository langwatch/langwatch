/**
 * A pass re-validates the caller's statement with the full policy, then runs it
 * inside a wrapper Analytics composes from the pass's kind; the caller never
 * writes wrapper SQL. @see specs/instant-evals/instant-eval-pipeline.feature
 */
import {
  LWQL_HYDRATION_TRACE_IDS_PARAMETER,
  langWatchQLPassSchema,
  type LangWatchQLPass,
} from "@langwatch/analytics-contract";
import { HandledError } from "@langwatch/handled-error";
import { describe, expect, it } from "vitest";

import {
  LangWatchQLExecutorRepository,
  type LangWatchQLExecutionRequest,
  type LangWatchQLExecutionResult,
} from "../../repositories/langwatch-ql-executor.repository.ts";
import { langWatchQLPassSql } from "../../rules/langwatch-ql-pass-sql.rules.ts";
import { LangWatchQLCapabilityService } from "../langwatch-ql-capability.service.ts";
import { LangWatchQLService } from "../langwatch-ql.service.ts";

const PROJECT = { id: "project-1", lwqlKey: "key-1" };
const STATEMENT =
  "SELECT TraceId, eval(TraceName, 'Is the name a greeting?') AS named FROM analytics.traces";
const CAPABILITY = LangWatchQLCapabilityService.create().tenantCapability({
  secret: PROJECT.lwqlKey,
});

const EVERY_PASS: readonly LangWatchQLPass[] = [
  { kind: "probe" },
  { kind: "count", limit: 10_001 },
  { kind: "keys", keyColumns: ["SpanId"], limit: 501, after: { traceId: "t0", spanId: "s0" } },
  { kind: "sample", keyColumns: ["ThreadId"], limit: 50, buckets: 4 },
  { kind: "page", traceIds: ["t1", "t2"] },
];

class RecordingExecutor extends LangWatchQLExecutorRepository {
  readonly requests: LangWatchQLExecutionRequest[] = [];

  execute(request: LangWatchQLExecutionRequest): Promise<LangWatchQLExecutionResult> {
    this.requests.push(request);

    return Promise.resolve({
      columns: [
        { name: "TraceId", type: "String" },
        { name: "named", type: "String" },
      ],
      rows: [],
      statistics: { elapsedMs: 1, rowsRead: 0, bytesRead: 0, rowsReturned: 0 },
    });
  }
}

function serviceOver(executor: RecordingExecutor | null) {
  return LangWatchQLService.create({
    executor,
    database: "analytics",
    limits: { maxRows: 100, maxResultBytes: 8_000_000 },
  });
}

async function refusalOf(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(
    () => undefined,
    (error: unknown) => error,
  );
}

function codeOf(error: unknown): string | undefined {
  return HandledError.isHandled(error) ? error.code : undefined;
}

describe("LangWatchQLService.executePass", () => {
  describe("given a statement calling eval at the top level, with the gate open", () => {
    /** @scenario "A statement calling eval at the top level runs its passes" */
    it("runs every pass kind as the caller's restricted identity", async () => {
      const executor = new RecordingExecutor();
      const service = serviceOver(executor);

      for (const pass of EVERY_PASS) {
        await service.executePass({
          project: PROJECT,
          protections: {},
          sql: STATEMENT,
          pass,
          isInstantEvalsEnabled: true,
        });
      }

      expect(executor.requests).toEqual(
        EVERY_PASS.map((pass) => {
          const composed = langWatchQLPassSql({ sql: STATEMENT, pass });

          return {
            sql: composed.sql,
            ...(Object.keys(composed.parameters).length > 0
              ? { parameters: composed.parameters }
              : {}),
            tenantCapability: CAPABILITY,
          };
        }),
      );
    });

    it("binds the caller's values beside the wrapper's own", async () => {
      const executor = new RecordingExecutor();

      await serviceOver(executor).executePass({
        project: PROJECT,
        protections: {},
        sql: `${STATEMENT} WHERE TraceName = {name:String}`,
        parameters: { name: "hello" },
        pass: { kind: "page", traceIds: ["t1"] },
        isInstantEvalsEnabled: true,
      });

      expect(executor.requests[0]?.parameters).toEqual({
        name: "hello",
        [LWQL_HYDRATION_TRACE_IDS_PARAMETER]: ["t1"],
      });
    });
  });

  describe("given a statement the policy refuses", () => {
    /** @scenario "A pass re-validates its statement with the full policy" */
    it("refuses a caller's own wrapper holding eval in a subquery, reaching no database", async () => {
      const executor = new RecordingExecutor();

      const refusal = await refusalOf(
        serviceOver(executor).executePass({
          project: PROJECT,
          protections: {},
          sql: `SELECT * FROM (\n${STATEMENT}\n) AS q LIMIT 0`,
          pass: { kind: "probe" },
          isInstantEvalsEnabled: true,
        }),
      );

      expect(codeOf(refusal)).toBe("lwql_not_permitted");
      expect(executor.requests).toEqual([]);
    });

    /** @scenario "A pass re-validates its statement with the full policy" */
    it("refuses a table outside the catalogue, reaching no database", async () => {
      const executor = new RecordingExecutor();

      const refusal = await refusalOf(
        serviceOver(executor).executePass({
          project: PROJECT,
          protections: {},
          sql: "SELECT name FROM system.tables",
          pass: { kind: "count", limit: 10 },
          isInstantEvalsEnabled: true,
        }),
      );

      expect(codeOf(refusal)).toBe("lwql_not_permitted");
      expect(executor.requests).toEqual([]);
    });

    /** @scenario "A pass re-validates its statement with the full policy" */
    it("refuses an eval call while the gate is closed", async () => {
      const executor = new RecordingExecutor();

      const refusal = await refusalOf(
        serviceOver(executor).executePass({
          project: PROJECT,
          protections: {},
          sql: STATEMENT,
          pass: { kind: "probe" },
        }),
      );

      expect(codeOf(refusal)).toBe("lwql_not_permitted");
      expect(executor.requests).toEqual([]);
    });
  });

  describe("given a pass outside the fixed wrapper shapes", () => {
    /** @scenario "A pass cannot carry SQL of its own" */
    it("refuses wrapper SQL, an unknown kind or an unlisted key column", () => {
      expect(
        langWatchQLPassSchema.validate({ kind: "probe", sql: "SELECT * FROM system.tables" }),
      ).toBe(false);
      expect(langWatchQLPassSchema.validate({ kind: "raw", sql: "SELECT 1" })).toBe(false);
      expect(
        langWatchQLPassSchema.validate({
          kind: "keys",
          keyColumns: ["TraceId FROM system.tables --"],
          limit: 10,
        }),
      ).toBe(false);
      expect(langWatchQLPassSchema.validate({ kind: "count", limit: "1 UNION ALL SELECT 1" })).toBe(
        false,
      );
    });

    /** @scenario "A pass cannot carry SQL of its own" */
    it("refuses a malformed bound before reaching the database", async () => {
      const executor = new RecordingExecutor();

      const refusal = await refusalOf(
        serviceOver(executor).executePass({
          project: PROJECT,
          protections: {},
          sql: STATEMENT,
          pass: { kind: "count", limit: 1.5 },
          isInstantEvalsEnabled: true,
        }),
      );

      expect(refusal).toBeInstanceOf(Error);
      expect(executor.requests).toEqual([]);
    });
  });

  describe("given no restricted identity is provisioned", () => {
    it("refuses with lwql_unavailable", async () => {
      const refusal = await refusalOf(
        serviceOver(null).executePass({
          project: PROJECT,
          protections: {},
          sql: STATEMENT,
          pass: { kind: "probe" },
          isInstantEvalsEnabled: true,
        }),
      );

      expect(codeOf(refusal)).toBe("lwql_unavailable");
    });
  });
});
