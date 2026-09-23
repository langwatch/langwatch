/**
 * The result bounds the service applies (#8085): a bare statement is capped by an appended
 * `LIMIT` and comes back whole, and a result past the byte ceiling is refused, never cut.
 * @see specs/lwql/result-paging.feature
 */
import { HandledError } from "@langwatch/handled-error";
import { describe, expect, it } from "vitest";

import {
  LangWatchQLExecutor,
  type LangWatchQLExecutionRequest,
  type LangWatchQLExecutionResult,
} from "../../repositories/langwatch-ql-executor.repository.ts";
import { LangWatchQLCapabilityService } from "../langwatch-ql-capability.service.ts";
import { LangWatchQLService } from "../langwatch-ql.service.ts";

const BOUNDED_TRACES =
  "SELECT TraceId FROM analytics.traces " +
  "WHERE OccurredAt >= toDateTime64('2026-02-16 00:00:00', 3)";

const EVERYTHING_VISIBLE = {
  canSeeCosts: true,
  canSeeCapturedInput: true,
  canSeeCapturedOutput: true,
};

/** Answers every statement with the rows it was given, recording what it was sent. */
class RecordingExecutor extends LangWatchQLExecutor {
  readonly requests: LangWatchQLExecutionRequest[] = [];

  constructor(private readonly rows: readonly Record<string, unknown>[]) {
    super();
  }

  execute(request: LangWatchQLExecutionRequest): Promise<LangWatchQLExecutionResult> {
    this.requests.push(request);

    return Promise.resolve({
      columns: [{ name: "TraceId", type: "String" }],
      rows: this.rows,
      statistics: { elapsedMs: 1, rowsRead: 10, bytesRead: 10, rowsReturned: this.rows.length },
    });
  }
}

function serviceOver(executor: RecordingExecutor, maxResultBytes = 8_000_000) {
  return LangWatchQLService.create({
    executor,
    database: "analytics",
    limits: { maxRows: 2, maxResultBytes },
  });
}

function run(service: LangWatchQLService) {
  return service.execute({
    project: { id: "project-1", lwqlKey: "key-1" },
    protections: EVERYTHING_VISIBLE,
    sql: BOUNDED_TRACES,
  });
}

describe("LangWatchQLService result bounds", () => {
  describe("given a statement that names no LIMIT and matches more rows than the cap", () => {
    /** @scenario "A capped result comes back as one page, never silently cut" */
    it("sends the statement with the cap appended and returns the page whole", async () => {
      const executor = new RecordingExecutor([{ TraceId: "a" }, { TraceId: "b" }]);

      const result = await run(serviceOver(executor));

      expect(executor.requests[0]?.sql.trimEnd().endsWith("LIMIT 2")).toBe(true);
      expect(result.rows).toEqual([{ TraceId: "a" }, { TraceId: "b" }]);
      expect(result).not.toHaveProperty("truncated");
      expect(result.diagnostics).toEqual([]);
    });
  });

  describe("given a result wider than the byte ceiling", () => {
    /** @scenario "A result past the byte ceiling is refused, never cut" */
    /** @scenario "Overflow throws and never silently truncates" */
    it("refuses it with lwql_result_too_large naming the cap, never a partial body", async () => {
      const executor = new RecordingExecutor([{ TraceId: "x".repeat(64) }]);

      const refusal = await run(serviceOver(executor, 16)).then(
        () => new Error("the oversized result was returned"),
        (error: unknown) => error,
      );

      if (!HandledError.isHandled(refusal)) throw refusal;
      expect(refusal.code).toBe("lwql_result_too_large");
      expect(refusal.meta).toMatchObject({ maxResultBytes: 16 });
    });
  });

  describe("given a statement that already names a LIMIT", () => {
    it("leaves it exactly as written", async () => {
      const executor = new RecordingExecutor([{ TraceId: "a" }]);
      const sql = `${BOUNDED_TRACES} ORDER BY TraceId LIMIT 1`;

      await serviceOver(executor).execute({
        project: { id: "project-1", lwqlKey: "key-1" },
        protections: EVERYTHING_VISIBLE,
        sql,
      });

      expect(executor.requests[0]?.sql).toBe(sql);
    });
  });

  describe("given a caller reading several projects, two sharing a secret", () => {
    /** @scenario "The tenant capability is the sorted set of the caller's project key hashes" */
    it("sends the sorted, deduplicated capability set of their secrets", async () => {
      const executor = new RecordingExecutor([]);
      const capability = LangWatchQLCapabilityService.create();

      await serviceOver(executor).executeForProjects({
        projects: [
          { id: "project-b", lwqlKey: "secret-b" },
          { id: "project-a", lwqlKey: "secret-a" },
          { id: "project-a-again", lwqlKey: "secret-a" },
        ],
        protections: EVERYTHING_VISIBLE,
        sql: BOUNDED_TRACES,
      });

      expect(executor.requests[0]?.tenantCapability.split(",")).toEqual(
        [
          capability.tenantCapability({ secret: "secret-a" }),
          capability.tenantCapability({ secret: "secret-b" }),
        ].toSorted(),
      );
    });
  });
});
