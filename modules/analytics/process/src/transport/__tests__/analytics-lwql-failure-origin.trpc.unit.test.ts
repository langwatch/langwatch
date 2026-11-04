/**
 * @vitest-environment node
 * The workbench door reports a failed query with the statement exactly as sent, and
 * never takes an origin from the caller.
 * @see specs/lwql/query-origin.feature
 */
import { createTrpcRuntime, TrpcRootDefinition } from "@langwatch/api/trpc";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { trpcTestMembers } from "@langwatch/test-harness/trpc-members";
import { describe, expect, it, vi } from "vitest";

import { analyticsLwqlTrpcTransport, type AnalyticsLwqlApi } from "../analytics-lwql.trpc.ts";

type TestContext = { actor: { id: string } };

const PROJECT = { projectId: "project-1" };
const SQL = "SELECT  1   AS   spaced\n";

/** The door over a fake app whose `executeLangWatchQL` is the test's. */
function doorOver(execute: AnalyticsLwqlApi["executeLangWatchQL"]) {
  const reportQueryFailure = vi.fn();
  const app = createApiFixture<AnalyticsLwqlApi>({
    isWorkbenchEnabled: async () => true,
    resolveRunCaller: async () =>
      ({
        project: { id: "project-1" },
        protections: {},
      }) as never,
    executeLangWatchQL: execute,
    reportQueryFailure,
  });
  const trpc = TrpcRootDefinition.forContext<TestContext>().create();
  const caller = createTrpcRuntime<TestContext>({
    root: trpc,
    procedure: trpc.procedure,
    members: trpcTestMembers<TestContext>({ permits: () => true }),
  })
    .mount(analyticsLwqlTrpcTransport, () => app)
    .createCaller({ actor: { id: "member-1" } });

  return { caller, reportQueryFailure };
}

describe("given a member runs a statement on analytics.lwql.query", () => {
  /** @scenario "A failed query on the tRPC door is reported with the statement exactly as sent" */
  it("reports the failure with the project and the statement as sent, and still fails the same way", async () => {
    const failure = Object.assign(new Error("Code: 47"), { code: "47" });
    const { caller, reportQueryFailure } = doorOver(async () => {
      throw failure;
    });

    await expect(caller.query({ ...PROJECT, sql: SQL })).rejects.toBeDefined();

    expect(reportQueryFailure).toHaveBeenCalledTimes(1);
    expect(reportQueryFailure).toHaveBeenCalledWith({
      projectId: "project-1",
      sql: SQL,
      error: failure,
    });
  });

  /** @scenario "A successful query is not reported" */
  it("reports nothing when the statement succeeds", async () => {
    const { caller, reportQueryFailure } = doorOver(async () => ({ rows: [] }) as never);

    await caller.query({ ...PROJECT, sql: SQL });

    expect(reportQueryFailure).not.toHaveBeenCalled();
  });

  /** @scenario "The caller cannot name the origin" */
  it("passes on no origin even when the request names one", async () => {
    const { caller, reportQueryFailure } = doorOver(async () => {
      throw new Error("Code: 215");
    });

    await caller.query({ ...PROJECT, sql: SQL, origin: "built_in" } as never).catch(() => void 0);

    expect(reportQueryFailure.mock.calls[0]?.[0]).not.toHaveProperty("origin");
    expect(Object.keys(reportQueryFailure.mock.calls[0]?.[0]).toSorted()).toEqual([
      "error",
      "projectId",
      "sql",
    ]);
  });
});
