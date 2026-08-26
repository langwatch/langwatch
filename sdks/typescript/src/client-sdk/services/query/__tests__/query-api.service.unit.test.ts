import { describe, expect, it, vi } from "vitest";
import { QueryApiError, QueryApiService } from "../query-api.service";
import { isLangWatchHandledError } from "@/internal/api/errors";
import type { LangwatchApiClient } from "@/internal/api/client";

/**
 * The canonical REST envelope a domain refusal answers with
 * (`app/api/shared/schemas.ts`), as it arrives from `/api/v1/query`: nested
 * under the JSON-RPC `error.data`, because a refusal the endpoint's own
 * handler raised IS wrapped in a JSON-RPC envelope — unlike the auth case
 * below.
 *
 * `query_scan_limit_exceeded` is the real ceiling code, mapped from
 * ClickHouse TOO_MANY_ROWS (158) / TOO_MANY_BYTES (307)
 * (`server/analytics/lwql/errors.ts:15`, `provisioning.ts:181-182`), and it
 * answers 422 — a well-formed query refused on a deliberate ceiling, not a
 * malformed or unauthorized one.
 */
const scanCeilingBody = {
  jsonrpc: "2.0",
  id: 1,
  error: {
    code: -32000,
    message: "Query refused.",
    data: {
      type: "unprocessable_entity",
      code: "query_scan_limit_exceeded",
      message: "This query would scan more data than this key allows.",
      trace_id: "4bf92f3577b34da6a3ce929d0e0e4736",
    },
  },
};

/**
 * The 401/403 shape `/api/v1/query` answers auth refusals with — the SAME
 * canonical envelope, but with NO `jsonrpc` sibling key, because the failure
 * is raised before the request reaches this endpoint's own JSON-RPC handler.
 * See the operation's doc comment in the generated types.
 */
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

describe("QueryApiService", () => {
  describe("when query() runs a LangWatchQL statement", () => {
    it("sends a query.run JSON-RPC request and returns the unwrapped result", async () => {
      const runResult = {
        columns: [{ name: "count", type: "number" }],
        rows: [{ count: 3 }],
        statistics: { elapsedMs: 12, rowsRead: 3, bytesRead: 128, rowsReturned: 1 },
        truncated: false,
        followsTimeWindow: true,
        followsGranularity: false,
        diagnostics: [],
      };
      const client = clientWith({
        data: { jsonrpc: "2.0", id: 1, result: runResult },
        response: new Response(null, { status: 200 }),
      });
      const service = new QueryApiService({ langwatchApiClient: client });

      const result = await service.query({ sql: "SELECT count(*) AS count" });

      expect(result).toEqual(runResult);
      expect(client.POST).toHaveBeenCalledWith(
        "/api/v1/query",
        expect.objectContaining({
          body: expect.objectContaining({
            jsonrpc: "2.0",
            method: "query.run",
            params: { sql: "SELECT count(*) AS count" },
          }),
        }),
      );
    });
  });

  describe("when schema() discovers the analytics catalog", () => {
    it("sends a query.schema JSON-RPC request with no params and returns the unwrapped result", async () => {
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
        data: { jsonrpc: "2.0", id: 1, result: schemaResult },
        response: new Response(null, { status: 200 }),
      });
      const service = new QueryApiService({ langwatchApiClient: client });

      const result = await service.schema();

      expect(result).toEqual(schemaResult);
      const call = (client.POST as ReturnType<typeof vi.fn>).mock.calls[0];
      const [, options] = call as [string, { body: Record<string, unknown> }];
      expect(options.body).toMatchObject({ jsonrpc: "2.0", method: "query.schema" });
      expect(options.body).not.toHaveProperty("params");
    });
  });

  describe("when the endpoint's own handler refuses on a ceiling, wrapped in JSON-RPC", () => {
    it("surfaces the canonical code carried in the JSON-RPC error.data, and the real status", async () => {
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

      // The canonical envelope rides one level deeper than every REST family's
      // (as the JSON-RPC `error.data`), so the service lifts it back out before
      // the shared reader sees it. Without that unwrap the reader finds only
      // `code: -32000`, calls the failure unnamed, and the caller loses the
      // ceiling's name, its trace id and the platform's own sentence.
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

  describe("when a JSON-RPC error carries no canonical envelope", () => {
    it("leaves the body alone rather than inventing a code from the transport's own", async () => {
      // A protocol-level refusal (a malformed envelope, an unknown method)
      // names no canonical code — only JSON-RPC's numeric one. The unwrap must
      // pass it through untouched: a numeric `-32601` is not a platform code,
      // and reporting it as one would be worse than reporting nothing.
      const service = serviceWith({
        error: {
          jsonrpc: "2.0",
          id: 1,
          error: { code: -32601, message: "Method not found." },
        },
        response: new Response(null, { status: 400 }),
      });

      const thrown = await service.query({ sql: "SELECT 1" }).then(
        () => {
          throw new Error("expected query to reject");
        },
        (error: unknown) => error,
      );

      expect(isLangWatchHandledError(thrown)).toBe(false);
      expect(thrown).toBeInstanceOf(QueryApiError);
      expect((thrown as QueryApiError).status).toBe(400);
    });
  });

  describe("when the failure body is not the platform's shape", () => {
    it("throws the family's own error, status attached, exactly as before", async () => {
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

  describe("when an auth refusal answers the bare canonical envelope, unwrapped in JSON-RPC", () => {
    it("still surfaces the platform's real code and status instead of choking on the missing envelope", async () => {
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
