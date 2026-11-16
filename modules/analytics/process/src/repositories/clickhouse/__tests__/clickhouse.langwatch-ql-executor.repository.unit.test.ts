/**
 * What the executor answers when the server does not know a function: a
 * statement calling one of our app functions names a deployment gap, never an
 * unknown error. Driven through a stubbed driver; the claim is the mapping.
 * @see specs/lwql/app-functions.feature
 * @see specs/analytics/dashboard-widget-resilience.feature
 * @see specs/lwql/api.feature
 */
import { inspect } from "node:util";

import { ClickHouseLogLevel } from "@clickhouse/client";
import { describe, expect, it, vi } from "vitest";

import { ClickHouseLangWatchQLExecutorRepository } from "../clickhouse.langwatch-ql-executor.repository.ts";

const { queryMock, clientOptions } = vi.hoisted(() => ({
  queryMock: vi.fn(),
  clientOptions: [] as unknown[],
}));

vi.mock("@clickhouse/client", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  createClient: (options: unknown) => {
    clientOptions.push(options);
    return { query: queryMock, close: async () => undefined };
  },
}));

/** A capability as production derives it: sha256 hex. */
const TENANT_A_CAPABILITY = "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08";
/** The projects a run is scoped to, which the query log's comment names. */
const PROJECT_IDS = ["project-a"];

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
  executor.execute({ sql, projectIds: PROJECT_IDS, tenantCapability: TENANT_A_CAPABILITY }).then(
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

describe("given the LangWatchQL identity is running as many statements as it may", () => {
  describe("when the server refuses one more", () => {
    /** @scenario "A busy query service is a named, retryable refusal" */
    it("refuses with lwql_busy, a retryable platform fault, rather than an unknown error", async () => {
      queryMock.mockRejectedValueOnce(
        Object.assign(
          new Error(
            "Code: 202. DB::Exception: Too many simultaneous queries for user lwql_reader. Current: 10, maximum: 10. (TOO_MANY_SIMULTANEOUS_QUERIES)",
          ),
          { code: "202", type: "TOO_MANY_SIMULTANEOUS_QUERIES" },
        ),
      );

      const refusal = await executor
        .execute({
          sql: "SELECT 1",
          projectIds: PROJECT_IDS,
          tenantCapability: TENANT_A_CAPABILITY,
        })
        .then(
          () => ({}),
          (error: { code?: string; fault?: string; httpStatus?: number; retryable?: boolean }) => ({
            code: error.code,
            fault: error.fault,
            httpStatus: error.httpStatus,
            retryable: error.retryable,
          }),
        );

      expect(refusal).toEqual({
        code: "lwql_busy",
        fault: "platform",
        httpStatus: 503,
        retryable: true,
      });
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

describe("given a bound parameter whose value does not fit its declared type", () => {
  describe("when the server refuses it as BAD_QUERY_PARAMETER", () => {
    /** @scenario "A parameter value that does not fit its declared type is refused with the parameter named" */
    it("refuses with lwql_parameter_invalid, a customer 400 naming only the parameter", async () => {
      queryMock.mockRejectedValueOnce(
        Object.assign(
          new Error(
            "Value last tuesday cannot be parsed as DateTime64(3) for query parameter 'start' because it isn't parsed completely: only 0 of 12 bytes was parsed: .",
          ),
          { code: "457", type: "BAD_QUERY_PARAMETER" },
        ),
      );

      const refusal = await executor
        .execute({
          sql: "SELECT count() FROM analytics.traces WHERE OccurredAt >= {start:DateTime64(3)}",
          projectIds: PROJECT_IDS,
          tenantCapability: TENANT_A_CAPABILITY,
        })
        .then(
          () => null,
          (error: { code?: string; fault?: string; httpStatus?: number; meta?: unknown }) => ({
            code: error.code,
            fault: error.fault,
            httpStatus: error.httpStatus,
            meta: error.meta,
          }),
        );

      expect(refusal).toEqual({
        code: "lwql_parameter_invalid",
        fault: "customer",
        httpStatus: 400,
        meta: { parameter: "start" },
      });
    });
  });
});

describe("given date-time parameters bound as ISO instants", () => {
  describe("when the executor sends them", () => {
    /** @scenario "An ISO instant bound to a date-time parameter is sent as the same moment the server can read" */
    it("sends Unix seconds for that moment and leaves every other value as bound", async () => {
      queryMock.mockResolvedValueOnce({ json: async () => ({ data: [], meta: [] }) });

      await executor.execute({
        sql:
          "SELECT count() FROM analytics.traces WHERE OccurredAt >= {start:DateTime64(3, 'UTC')}" +
          " AND toStartOfDay(OccurredAt) = {day:DateTime} AND OccurredAt < {end:Nullable(DateTime64(3))}" +
          " AND TraceId = {label:String}",
        parameters: {
          start: "2026-11-01T00:00:00Z",
          day: "2026-11-01T02:00:00+02:00",
          end: "2026-11-02 00:00:00.000",
          label: "2026-11-01T00:00:00Z",
        },
        projectIds: PROJECT_IDS,
        tenantCapability: TENANT_A_CAPABILITY,
      });

      expect(queryMock.mock.lastCall?.[0].query_params).toEqual({
        start: "1793491200.000000000",
        day: "1793491200",
        end: "2026-11-02 00:00:00.000",
        label: "2026-11-01T00:00:00Z",
      });
    });

    it("leaves a name declared as both DateTime and DateTime64 as bound", async () => {
      queryMock.mockResolvedValueOnce({ json: async () => ({ data: [], meta: [] }) });

      await executor.execute({
        sql: "SELECT {t:DateTime} AS a, {t:DateTime64(9)} AS b FROM analytics.traces",
        parameters: { t: "2026-11-01T00:00:00.5Z" },
        projectIds: PROJECT_IDS,
        tenantCapability: TENANT_A_CAPABILITY,
      });

      expect(queryMock.mock.lastCall?.[0].query_params).toEqual({ t: "2026-11-01T00:00:00.5Z" });
    });

    /** @scenario "Placeholder text inside a string literal or comment does not change a bound value" */
    it("ignores placeholder text inside string literals, quoted identifiers and comments", async () => {
      queryMock.mockResolvedValueOnce({ json: async () => ({ data: [], meta: [] }) });

      await executor.execute({
        sql:
          "SELECT {s:String} AS v, 'it''s {s:DateTime}' AS a, 'x\\' {s:DateTime}' AS b," +
          " `{s:DateTime}` AS c -- {s:DateTime}\n" +
          "/* {s:DateTime} /* nested */ {s:DateTime} */ # {s:DateTime}\n" +
          "FROM analytics.traces",
        parameters: { s: "2026-11-01T00:00:00Z" },
        projectIds: PROJECT_IDS,
        tenantCapability: TENANT_A_CAPABILITY,
      });

      expect(queryMock.mock.lastCall?.[0].query_params).toEqual({ s: "2026-11-01T00:00:00Z" });
    });

    it("ignores placeholder text inside heredoc strings and still reads the real one", async () => {
      queryMock.mockResolvedValueOnce({ json: async () => ({ data: [], meta: [] }) });

      await executor.execute({
        sql:
          "SELECT $$'$$, {s:String}, $$'{s:DateTime}$$, $q$it's$q$ AS x$y$z," +
          " {t:DateTime} FROM analytics.traces",
        parameters: { s: "2026-11-01T00:00:00Z", t: "2026-11-01T00:00:00Z" },
        projectIds: PROJECT_IDS,
        tenantCapability: TENANT_A_CAPABILITY,
      });

      expect(queryMock.mock.lastCall?.[0].query_params).toEqual({
        s: "2026-11-01T00:00:00Z",
        t: "1793491200",
      });
    });

    it("leaves a name declared as both String and DateTime as bound", async () => {
      queryMock.mockResolvedValueOnce({ json: async () => ({ data: [], meta: [] }) });

      await executor.execute({
        sql: "SELECT {s:String} AS v, {s:DateTime} AS w FROM analytics.traces",
        parameters: { s: "2026-11-01T00:00:00Z" },
        projectIds: PROJECT_IDS,
        tenantCapability: TENANT_A_CAPABILITY,
      });

      expect(queryMock.mock.lastCall?.[0].query_params).toEqual({ s: "2026-11-01T00:00:00Z" });
    });

    it("reads date-time types in any case and under LowCardinality", async () => {
      queryMock.mockResolvedValueOnce({ json: async () => ({ data: [], meta: [] }) });

      await executor.execute({
        sql:
          "SELECT {a:datetime}, {b:DATETIME64(3)}, {c:LowCardinality(DateTime)}," +
          " {d:Nullable( dateTime64(3, 'UTC') )}, {e:DateTime32} FROM analytics.traces",
        parameters: {
          e: "2026-11-01T00:00:00Z",
          a: "2026-11-01T00:00:00Z",
          b: "2026-11-01T00:00:00Z",
          c: "2026-11-01T00:00:00Z",
          d: "2026-11-01T00:00:00.25Z",
        },
        projectIds: PROJECT_IDS,
        tenantCapability: TENANT_A_CAPABILITY,
      });

      expect(queryMock.mock.lastCall?.[0].query_params).toEqual({
        a: "1793491200",
        b: "1793491200.000000000",
        c: "1793491200",
        d: "1793491200.250000000",
        e: "1793491200",
      });
    });
  });
});

describe("given a statement and its tenant capability", () => {
  describe("when the executor sends it", () => {
    /** @scenario "The capability never appears in a request URL or a server log" */
    it("carries the capability in the statement's only SETTINGS clause, not in the request settings", async () => {
      queryMock.mockReset();
      queryMock.mockResolvedValueOnce({
        json: async () => ({ data: [], meta: [], statistics: { elapsed: 0 } }),
      });

      await executor.execute({
        sql: "SELECT 1 -- a trailing comment;",
        projectIds: PROJECT_IDS,
        tenantCapability: TENANT_A_CAPABILITY,
      });

      const [request] = queryMock.mock.calls[0] as [
        { query: string; clickhouse_settings?: unknown },
      ];
      expect(request.clickhouse_settings).toBeUndefined();
      expect(request.query).toMatch(
        new RegExp(
          `\\nSETTINGS custom_api_key_hash = '${TENANT_A_CAPABILITY}', ` +
            "log_comment = 'lwql:project=project-a'$",
        ),
      );
      expect(request.query.match(/\bSETTINGS\b/g)).toHaveLength(1);
    });
  });

  describe("when the run is scoped to no project", () => {
    /** @scenario "The query log names the tenant without the raw key or its hash" */
    it("still sends, naming no project in the log comment", async () => {
      queryMock.mockReset();
      queryMock.mockResolvedValueOnce({
        json: async () => ({ data: [], meta: [], statistics: { elapsed: 0 } }),
      });

      await executor.execute({ sql: "SELECT 1", tenantCapability: "", projectIds: [] });

      const [request] = queryMock.mock.calls[0] as [{ query: string }];
      expect(request.query).toMatch(/, log_comment = 'lwql:project='$/);
    });
  });

  describe("when a project id could break out of the log comment", () => {
    /** @scenario "The query log names the tenant without the raw key or its hash" */
    it("refuses to inline it and sends nothing", async () => {
      queryMock.mockReset();

      await expect(
        executor.execute({
          sql: "SELECT 1",
          tenantCapability: TENANT_A_CAPABILITY,
          projectIds: ["project-a', log_comment = 'lwql:project=project-b"],
        }),
      ).rejects.toThrow("not safe to name in the query log");
      expect(queryMock).not.toHaveBeenCalled();
    });
  });

  describe("when the capability is not lowercase hex", () => {
    it("refuses to inline it and sends nothing", async () => {
      queryMock.mockReset();

      await expect(
        executor.execute({
          sql: "SELECT 1",
          projectIds: PROJECT_IDS,
          tenantCapability: "x' SETTINGS readonly = 0 --",
        }),
      ).rejects.toThrow("not lowercase hex");
      expect(queryMock).not.toHaveBeenCalled();
    });
  });
});

describe("given the server quotes the failing statement back in its error", () => {
  const TENANT_B_CAPABILITY = "60303ae22b998861bce3b28f33eec1be758a213c86c93c076dbe9f558c11c752";
  const joined = `${TENANT_A_CAPABILITY},${TENANT_B_CAPABILITY}`;
  const cause = new Error("the socket's own reason");
  const quoting = (code: string, type: string) =>
    Object.assign(
      new Error(
        `Code: ${code}. DB::Exception: failed at SETTINGS custom_api_key_hash = '${joined}'. (${type})`,
        { cause },
      ),
      { code, type },
    );

  for (const [code, type] of [
    ["62", "SYNTAX_ERROR"],
    ["47", "UNKNOWN_IDENTIFIER"],
  ] as const) {
    describe(`when it refuses with ${type}`, () => {
      /** @scenario "The capability never appears in a request URL or a server log" */
      it("throws a refusal whose message, stack and reasons hold no hash", async () => {
        const driverError = quoting(code, type);
        queryMock.mockRejectedValueOnce(driverError);

        const thrown = await executor
          .execute({
            sql: "SELECT nope FROM traces",
            projectIds: PROJECT_IDS,
            tenantCapability: joined,
          })
          .then(
            () => null,
            (error: unknown) => error,
          );

        const everything = inspect(thrown, { depth: 8 });
        expect(thrown).not.toBeNull();
        for (const value of [joined, TENANT_A_CAPABILITY, TENANT_B_CAPABILITY]) {
          expect(everything).not.toContain(value);
        }
        expect(everything).toContain("[HIDDEN]");
        // A copy, not the driver's error rewritten: its code, type and cause carried over.
        expect(driverError.message).toContain(joined);
        const [reason] = (thrown as { reasons?: unknown[] }).reasons ?? [];
        expect(reason).not.toBe(driverError);
        expect(reason).toMatchObject({ code, type, cause });
      });
    });
  }
});

describe("given 26.8's refusal whose scope text echoes the appended SETTINGS clause", () => {
  const echoing = () =>
    Object.assign(
      new Error(
        "Unknown expression identifier `Email` in scope SELECT Email FROM lwql_pgengine.annotations " +
          `SETTINGS custom_api_key_hash = '${TENANT_A_CAPABILITY}', log_comment = 'lwql:project=project-a'.`,
      ),
      { code: "47", type: "UNKNOWN_IDENTIFIER" },
    );

  describe("when the executor runs the statement", () => {
    /** @scenario "The capability never appears in a request URL or a server log" */
    it("hands the driver no logger of its own, and throws a refusal that holds no hash", async () => {
      expect(clientOptions).toContainEqual(
        expect.objectContaining({ log: { level: ClickHouseLogLevel.OFF } }),
      );
      queryMock.mockRejectedValueOnce(echoing());

      const thrown = await executor
        .execute({
          sql: "SELECT Email FROM annotations",
          projectIds: PROJECT_IDS,
          tenantCapability: TENANT_A_CAPABILITY,
        })
        .then(
          () => null,
          (error: unknown) => error,
        );

      expect(thrown).not.toBeNull();
      expect(inspect(thrown, { depth: 8 })).not.toContain(TENANT_A_CAPABILITY);
    });
  });
});
