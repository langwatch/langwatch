/**
 * What the executor answers when the server does not know a function: a
 * statement calling one of our app functions names a deployment gap, never an
 * unknown error. Driven through a stubbed driver; the claim is the mapping.
 * @see specs/lwql/app-functions.feature
 */
import { describe, expect, it, vi } from "vitest";

import { ClickHouseLangWatchQLExecutorRepository } from "../clickhouse.langwatch-ql-executor.repository.ts";

const { queryMock } = vi.hoisted(() => ({ queryMock: vi.fn() }));

vi.mock("@clickhouse/client", () => ({
  createClient: () => ({ query: queryMock, close: async () => undefined }),
}));

const executor = ClickHouseLangWatchQLExecutorRepository.create({
  connection: {
    url: "http://clickhouse.invalid:8123",
    username: "lwql_reader",
    password: "unused",
    database: "analytics",
    tenantSetting: "custom_api_key_hash",
  },
});

const refusalOf = (sql: string) =>
  executor.execute({ sql, tenantCapability: "tenant-a" }).then(
    () => ({ code: "none", fault: "none", httpStatus: 0 }),
    (error: { code?: string; fault?: string; httpStatus?: number }) => ({
      code: error.code,
      fault: error.fault,
      httpStatus: error.httpStatus,
    }),
  );

const unknownFunction = () =>
  Object.assign(
    new Error("Code: 46. DB::Exception: Unknown function conversation. (UNKNOWN_FUNCTION)"),
    { code: "46", type: "UNKNOWN_FUNCTION" },
  );

describe("given a statement calling a catalogued app function", () => {
  describe("when the server has no such function", () => {
    /** @scenario "A query using an app function against a server with no such function refuses clearly" */
    it("refuses with lwql_app_function_unavailable, a platform fault, rather than an unknown error", async () => {
      queryMock.mockRejectedValueOnce(unknownFunction());

      const refusal = await refusalOf(
        "SELECT TraceId, conversation(ConversationId) AS transcript FROM analytics.traces",
      );

      expect(refusal).toEqual({
        code: "lwql_app_function_unavailable",
        fault: "platform",
        httpStatus: 503,
      });
    });
  });
});

describe("given a statement that calls no app function", () => {
  describe("when the server does not know a native function it used", () => {
    /** @scenario "An unknown native function is not reported as a missing app function" */
    it("translates the error normally rather than blaming the extraction functions", async () => {
      queryMock.mockRejectedValueOnce(unknownFunction());

      const refusal = await refusalOf("SELECT toBool(1) AS flag FROM analytics.traces");

      expect(refusal.code).not.toBe("lwql_app_function_unavailable");
    });
  });
});

describe("given a statement the server rejects as written", () => {
  describe.each([
    [
      "driver properties",
      () => Object.assign(new Error("boom"), { code: "184", type: "ILLEGAL_AGGREGATION" }),
    ],
    [
      "raw HTTP text",
      () =>
        new Error(
          "Code: 184. DB::Exception: Aggregate function any(trace_id) AS trace_id is found in WHERE in query. (ILLEGAL_AGGREGATION)",
        ),
    ],
  ])("when the refusal arrives as %s", (_form, refusal) => {
    /** @scenario "A query the database rejects as written is refused as the caller's fault" */
    it("refuses with lwql_invalid_query, a customer fault, rather than a 500", async () => {
      queryMock.mockRejectedValueOnce(refusal());

      expect(
        await refusalOf(
          "SELECT any(trace_id) AS trace_id FROM analytics.traces WHERE trace_id = 'x'",
        ),
      ).toEqual({
        code: "lwql_invalid_query",
        fault: "customer",
        httpStatus: 400,
      });
    });
  });
});

describe("given a refusal that describes the deployment", () => {
  describe("when the server reports a missing object", () => {
    /** @scenario "A refusal that describes the deployment is not reported as an invalid query" */
    it("keeps lwql_unavailable ahead of the invalid-query mapping", async () => {
      queryMock.mockRejectedValueOnce(
        Object.assign(new Error("boom"), { code: "60", type: "UNKNOWN_TABLE" }),
      );

      expect((await refusalOf("SELECT 1 FROM analytics.traces")).code).toBe("lwql_unavailable");
    });
  });
});
