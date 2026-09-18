/**
 * What the executor does when the server does not know an app function.
 *
 * The validator admits a function name only from its own allowlist or from the
 * app-function catalog, and the provisioning DDL is generated from that same
 * catalog. So an `UNKNOWN_FUNCTION` coming back can never be something a
 * caller wrote: it means this deployment's ClickHouse has not been provisioned
 * with the projection UDFs the API declares. That has to reach the caller as a
 * named platform failure rather than as an unknown error with a trace id.
 *
 * Driven through a stubbed driver because the claim is about the mapping, not
 * about ClickHouse: the driver error shapes themselves are pinned by
 * `translate-query-error.unit.test.ts` and by the harness suites.
 *
 * @see ../executor.ts
 * @see specs/lwql/app-functions.feature
 */

import { describe, expect, it, vi } from "vitest";

import type { LangWatchQLConnection } from "../connection";
import { createLangWatchQLExecutor } from "../executor";

const { queryMock } = vi.hoisted(() => ({ queryMock: vi.fn() }));

vi.mock("@clickhouse/client", () => ({
  createClient: () => ({
    query: queryMock,
    close: async () => undefined,
  }),
}));

const CONNECTION: LangWatchQLConnection = {
  url: "http://clickhouse.invalid:8123",
  username: "lwql_reader",
  password: "unused",
  database: "analytics",
  tenantSetting: "custom_api_key_hash",
};

const run = ({ usesAppFunctions }: { usesAppFunctions: boolean }) =>
  createLangWatchQLExecutor(CONNECTION).execute({
    sql: usesAppFunctions
      ? "SELECT TraceId, conversation(ConversationId) AS transcript FROM analytics.traces"
      : "SELECT toBool(1) AS flag FROM analytics.traces",
    tenantCapability: "tenant-a",
    usesAppFunctions,
  });

const unknownFunction = () =>
  Object.assign(
    new Error(
      "Code: 46. DB::Exception: Unknown function conversation. (UNKNOWN_FUNCTION)",
    ),
    { code: "46", type: "UNKNOWN_FUNCTION" },
  );

describe("given a statement calling a catalogued app function", () => {
  describe("when the server has no such function", () => {
    /** @scenario "A query using an app function against a server with no such function refuses clearly" */
    it("refuses with lwql_app_function_unavailable rather than an unknown error", async () => {
      queryMock.mockRejectedValueOnce(unknownFunction());

      const refusal = (await run({ usesAppFunctions: true }).catch(
        (error: unknown) => error,
      )) as {
        code: string;
        fault: string;
        httpStatus: number;
      };

      expect(refusal.code).toBe("lwql_app_function_unavailable");
      // A deployment gap is ours, so it must not be logged as routine
      // customer noise.
      expect(refusal.fault).toBe("platform");
      expect(refusal.httpStatus).toBe(503);
    });
  });
});

describe("given a statement that calls no app function", () => {
  describe("when the server does not know a native function it used", () => {
    /** @scenario "An unknown native function is not reported as a missing app function" */
    it("translates the error normally rather than blaming the extraction functions", async () => {
      // The validator's allowlist admits native ClickHouse functions too, and
      // the BYO contract pins no server version, so an older server refusing
      // `toBool` must not be reported as unprovisioned app functions.
      queryMock.mockRejectedValueOnce(unknownFunction());

      const refusal = (await run({ usesAppFunctions: false }).catch(
        (error: unknown) => error,
      )) as { code?: string };

      expect(refusal.code).not.toBe("lwql_app_function_unavailable");
    });
  });
});
