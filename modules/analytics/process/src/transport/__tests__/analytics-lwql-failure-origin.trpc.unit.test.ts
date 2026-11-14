/**
 * @vitest-environment node
 * The workbench door reports a failed query with the statement exactly as sent, and
 * never takes an origin from the caller.
 * @see specs/lwql/query-origin.feature
 */
import { LangWatchQLInvalidQueryError } from "@langwatch/analytics-contract";
import { createTrpcRuntime, TrpcRootDefinition } from "@langwatch/api/trpc";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { trpcTestMembers } from "@langwatch/test-harness/trpc-members";
import { describe, expect, it, vi } from "vitest";

import { analyticsLwqlTrpcTransport, type AnalyticsLwqlApi } from "../analytics-lwql.trpc.ts";

type TestContext = { actor: { id: string } };

const PROJECT = { projectId: "project-1" };
const SQL = "SELECT  1   AS   spaced\n";

/** The door over a fake app whose `executeWorkbenchQuery` is the test's. */
function doorOver(execute: AnalyticsLwqlApi["executeWorkbenchQuery"]) {
  const executeWorkbenchQuery = vi.fn(execute);
  const app = createApiFixture<AnalyticsLwqlApi>({
    isWorkbenchEnabled: async () => true,
    resolveRunCaller: async () =>
      ({
        project: { id: "project-1" },
        protections: {},
      }) as never,
    executeWorkbenchQuery,
  });
  const trpc = TrpcRootDefinition.forContext<TestContext>().create();
  const caller = createTrpcRuntime<TestContext>({
    root: trpc,
    procedure: trpc.procedure,
    members: trpcTestMembers<TestContext>({ permits: () => true }),
  })
    .mount(analyticsLwqlTrpcTransport, () => app)
    .createCaller({ actor: { id: "member-1" } });

  return { caller, executeWorkbenchQuery };
}

describe("given a member runs a statement on analytics.lwql.query", () => {
  /** @scenario "A failed query on the tRPC door is reported with the statement exactly as sent" */
  it("hands the statement as sent to the one workbench operation and surfaces its error as is", async () => {
    const failure = new LangWatchQLInvalidQueryError();
    const { caller, executeWorkbenchQuery } = doorOver(async () => {
      throw failure;
    });

    const rejection = await caller.query({ ...PROJECT, sql: SQL }).catch((error: unknown) => error);

    expect((rejection as { cause: unknown }).cause).toBe(failure);
    expect(executeWorkbenchQuery).toHaveBeenCalledTimes(1);
    expect(executeWorkbenchQuery.mock.calls[0]?.[0]).toMatchObject({ sql: SQL });
  });

  /** @scenario "The caller cannot name the origin" */
  it("passes on no origin even when the request names one", async () => {
    const { caller, executeWorkbenchQuery } = doorOver(async () => ({ rows: [] }) as never);

    await caller.query({ ...PROJECT, sql: SQL, origin: "built_in" } as never);

    expect(executeWorkbenchQuery.mock.calls[0]?.[0]).not.toHaveProperty("origin");
  });
});
