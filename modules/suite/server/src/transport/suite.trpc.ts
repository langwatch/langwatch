/**
 * The server half of `suites.*`: a permission and a handler per procedure.
 * What a suite id decides — the plan first, the test suite second; what a test
 * suite refuses; which organization the project is in — is the application's.
 */

import { defineTrpcRouter } from "@langwatch/api/trpc";
import { SuiteApi, suiteTrpc, tryExtractSuiteId } from "@langwatch/suite-contract";
import type {
  SimulationExternalSetSummary,
  SuiteRunSummary,
} from "@langwatch/scenario-contract";
import { nowInstant } from "@langwatch/time";

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

export const suiteTrpcTransport = defineTrpcRouter(SuiteApi, suiteTrpc)
  .procedure("create")
  .withPermission("scenarios:manage")
  .handle(async ({ app, input }) => app.create(input))

  .procedure("getAll")
  .withPermission("scenarios:view")
  .handle(async ({ app, input }) => {
    const kinds = input.kinds ?? ["run_plan"];
    const [suites, testSuites] = await Promise.all([
      kinds.includes("run_plan") ? app.list({ projectId: input.projectId }) : Promise.resolve([]),
      kinds.includes("test_suite")
        ? app.listTestSuites({ projectId: input.projectId })
        : Promise.resolve([]),
    ]);

    return [...suites, ...testSuites].sort(
      (left, right) => right.updatedAt.getTime() - left.updatedAt.getTime(),
    );
  })

  .procedure("getById")
  .withPermission("scenarios:view")
  .handle(async ({ app, input }) => {
    const found = await app.getByIdOrTestSuite(input);

    return found.kind === "suite" ? found.suite : found.testSuite;
  })

  .procedure("update")
  .withPermission("scenarios:manage")
  .handle(async ({ app, input }) => {
    const updated = await app.update(input);

    return updated.kind === "suite" ? updated.suite : updated.testSuite;
  })

  .procedure("duplicate")
  .withPermission("scenarios:manage")
  .handle(async ({ app, input }) => app.duplicate(input))

  .procedure("archive")
  .withPermission("scenarios:manage")
  .handle(async ({ app, input }) => app.archive(input))

  .procedure("resolveArchivedNames")
  .withPermission("scenarios:view")
  .handle(async ({ app, input }) => app.resolveArchivedNames(input))

  // No catch: a suite execution error is a HandledError, and wrapping it drops
  // the `cause` the middleware maps, turning a 422 the UI can act on into a 500.
  .procedure("run")
  .withPermission("scenarios:manage")
  .handle(async ({ app, input, actor }) => {
    const result = await app.run({
      id: input.id,
      projectId: input.projectId,
      idempotencyKey: input.idempotencyKey,
      batchRunId: input.batchRunId,
      parameters: input.parameters,
      note: input.note,
      // A run started here was started by the signed-in person in front of the
      // app, so the surface it records is "user".
      actor: { id: actor.id, label: "user" },
    });

    return { scheduled: true, ...result };
  })

  .procedure("runPlan")
  .withPermission("scenarios:manage")
  .handle(async ({ app, input, actor }) => {
    const result = await app.runPlan({
      projectId: input.projectId,
      name: input.name,
      config: input.config,
      idempotencyKey: input.idempotencyKey,
      batchRunId: input.batchRunId,
      parameters: input.parameters,
      note: input.note,
      actor: { id: actor.id, label: "user" },
    });

    return { scheduled: true, ...result };
  })

  .procedure("runAll")
  .withPermission("scenarios:manage")
  .handle(async ({ app, input, actor }) => {
    const result = await app.runAll({
      projectId: input.projectId,
      idempotencyKey: input.idempotencyKey,
      batchRunId: input.batchRunId,
      targets: input.targets,
      parameters: input.parameters,
      note: input.note,
      actor: { id: actor.id, label: "user" },
    });

    return { scheduled: true, ...result };
  })

  .procedure("getSummaries")
  .withPermission("scenarios:view")
  .handle(async ({ app, input }) =>
    tallyBySuite(
      await app.getInternalSuiteSummaries({
        projectId: input.projectId,
        ...windowOf(input),
      }),
    ),
  )
  .build();

/** The last thirty days, unless the caller named its own window. */
function windowOf(input: { startDate?: number; endDate?: number }): {
  startDate: number;
  endDate: number;
} {
  const now = nowInstant().epochMilliseconds;

  return {
    startDate: input.startDate ?? now - THIRTY_DAYS_MS,
    endDate: input.endDate ?? now,
  };
}

/** The run tallies, keyed by the suite the result set belongs to. */
function tallyBySuite(
  summaries: readonly SimulationExternalSetSummary[],
): Record<string, SuiteRunSummary> {
  const rows = summaries.flatMap((summary) => {
    const suiteId = tryExtractSuiteId(summary.scenarioSetId);

    return suiteId
      ? [
          [
            suiteId,
            {
              passedCount: summary.passedCount,
              failedCount: summary.failedCount,
              totalCount: summary.totalCount,
              lastRunTimestamp: summary.lastRunTimestamp,
            },
          ] as const,
        ]
      : [];
  });

  return Object.fromEntries(rows);
}
