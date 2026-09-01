import { describe, expect, it, vi } from "vitest";
import { QueryApiError, QueryApiService } from "../query-api.service";
import { isLangWatchHandledError } from "@/internal/api/errors";
import type { LangwatchApiClient } from "@/internal/api/client";

/**
 * The canonical REST envelope a domain refusal answers with
 * (`app/api/shared/schemas.ts`), as it arrives from `/api/v1/query`: at the
 * top level of the body, the same place every other REST family puts it.
 *
 * `query_scan_limit_exceeded` is the real ceiling code, mapped from
 * ClickHouse TOO_MANY_ROWS (158) / TOO_MANY_BYTES (307)
 * (`server/analytics/lwql/errors.ts:15`, `provisioning.ts:181-182`), and it
 * answers 422 — a well-formed query refused on a deliberate ceiling, not a
 * malformed or unauthorized one.
 */
const scanCeilingBody = {
  error: {
    type: "unprocessable_entity",
    code: "query_scan_limit_exceeded",
    message: "This query would scan more data than this key allows.",
    trace_id: "4bf92f3577b34da6a3ce929d0e0e4736",
  },
};

/** The 401/403 shape, which is the same envelope at the same level. */
const unauthorizedBody = {
  error: {
    type: "unauthorized",
    code: "invalid_api_key",
    message: "The provided API key is invalid.",
    trace_id: "1234567890abcdef1234567890abcdef",
  },
};

const clientWith = (result: {
  data?: unknown;
  error?: unknown;
  response?: Response;
}): LangwatchApiClient =>
  ({
    GET: vi.fn(async () => result),
    POST: vi.fn(async () => result),
    PATCH: vi.fn(async () => result),
    PUT: vi.fn(async () => result),
    DELETE: vi.fn(async () => result),
  }) as unknown as LangwatchApiClient;

const serviceWith = (result: {
  data?: unknown;
  error?: unknown;
  response?: Response;
}): QueryApiService =>
  new QueryApiService({ langwatchApiClient: clientWith(result) });

describe("given a QueryApiService", () => {
  describe("when query() runs a LangWatchQL statement", () => {
    it("posts the query as the body and returns the result itself", async () => {
      const runResult = {
        columns: [{ name: "count", type: "number" }],
        rows: [{ count: 3 }],
        statistics: {
          elapsedMs: 12,
          rowsRead: 3,
          bytesRead: 128,
          rowsReturned: 1,
        },
        truncated: false,
        followsTimeWindow: true,
        followsGranularity: false,
        diagnostics: [],
      };
      const client = clientWith({
        data: runResult,
        response: new Response(null, { status: 200 }),
      });
      const service = new QueryApiService({ langwatchApiClient: client });

      const result = await service.query({ sql: "SELECT count(*) AS count" });

      expect(result).toEqual(runResult);
      expect(client.POST).toHaveBeenCalledWith("/api/v1/query", {
        body: { sql: "SELECT count(*) AS count" },
      });
    });

    /** Nothing of the old transport may survive in the body a caller sends. */
    it("sends no envelope members alongside the query", async () => {
      const client = clientWith({
        data: {},
        response: new Response(null, { status: 200 }),
      });
      await new QueryApiService({ langwatchApiClient: client }).query({
        sql: "SELECT 1",
      });

      const [, options] = (client.POST as ReturnType<typeof vi.fn>).mock
        .calls[0] as [string, { body: Record<string, unknown> }];
      expect(options.body).not.toHaveProperty("jsonrpc");
      expect(options.body).not.toHaveProperty("method");
      expect(options.body).not.toHaveProperty("params");
    });
  });

  describe("when schema() discovers the analytics catalog", () => {
    it("GETs the schema door and returns the catalog itself", async () => {
      const schemaResult = {
        database: "analytics",
        datasets: [
          {
            name: "traces",
            description: "Trace-level records.",
            grain: "one row per trace",
            joinKeys: ["trace_id"],
            timeColumn: "started_at",
            freshness: "near real-time",
            columns: [],
            exampleSql: "SELECT * FROM traces LIMIT 10",
          },
        ],
      };
      const client = clientWith({
        data: schemaResult,
        response: new Response(null, { status: 200 }),
      });
      const service = new QueryApiService({ langwatchApiClient: client });

      const result = await service.schema();

      expect(result).toEqual(schemaResult);
      expect(client.GET).toHaveBeenCalledWith("/api/v1/query/schema", {});
      expect(client.POST).not.toHaveBeenCalled();
    });
  });

  describe("when the endpoint refuses on a ceiling", () => {
    it("surfaces the canonical code and the real status", async () => {
      const service = serviceWith({
        error: scanCeilingBody,
        response: new Response(null, { status: 422 }),
      });

      const thrown = await service.query({ sql: "SELECT 1" }).then(
        () => {
          throw new Error("expected query to reject");
        },
        (error: unknown) => error,
      );

      // The canonical envelope arrives where the shared reader already looks,
      // so nothing is unwrapped on the way — this family publishes the same
      // error shape as every other one.
      expect(isLangWatchHandledError(thrown)).toBe(true);
      expect(thrown).toMatchObject({
        code: "query_scan_limit_exceeded",
        httpStatus: 422,
        traceId: "4bf92f3577b34da6a3ce929d0e0e4736",
      });
      expect((thrown as Error).message).toContain(
        "This query would scan more data than this key allows.",
      );
    });
  });

  describe("when the failure body is not the platform's shape", () => {
    it("throws the family's own error, status attached", async () => {
      const service = serviceWith({
        error: "<html>bad gateway</html>",
        response: new Response(null, { status: 502 }),
      });

      const thrown = await service.query({ sql: "SELECT 1" }).then(
        () => {
          throw new Error("expected query to reject");
        },
        (error: unknown) => error,
      );

      expect(isLangWatchHandledError(thrown)).toBe(false);
      expect(thrown).toBeInstanceOf(QueryApiError);
      expect((thrown as QueryApiError).status).toBe(502);
    });
  });

  describe("when an auth refusal answers before the handler runs", () => {
    it("surfaces the platform's real code and status", async () => {
      const service = serviceWith({
        error: unauthorizedBody,
        response: new Response(null, { status: 401 }),
      });

      const thrown = await service.schema().then(
        () => {
          throw new Error("expected schema to reject");
        },
        (error: unknown) => error,
      );

      expect(isLangWatchHandledError(thrown)).toBe(true);
      expect(thrown).toMatchObject({
        code: "invalid_api_key",
        httpStatus: 401,
        traceId: "1234567890abcdef1234567890abcdef",
      });
      expect((thrown as Error).message).toContain(
        "The provided API key is invalid.",
      );
    });
  });
});
