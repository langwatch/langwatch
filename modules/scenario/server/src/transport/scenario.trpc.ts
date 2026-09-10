/**
 * The server half of `scenarios.*`. One flat namespace, as the browser has
 * always called it: `scenarios:view` reads, `scenarios:manage` writes, runs
 * and cancels.
 *
 * Every refusal travels as the handled error the application already raises -
 * a missing scenario is `scenario_not_found` at 404, a run this project cannot
 * start is `scenario_run_rejected` at 400 - rather than being flattened into a
 * transport code that drops what the client could act on.
 */
import { defineTrpcRouter } from "@langwatch/api/trpc";
import { NotFoundError } from "@langwatch/handled-error";
import { createLogger } from "@langwatch/observability";
import {
  generateBatchRunId,
  generateScenarioRunId,
  getOnPlatformSetId,
  isInternalSetId,
  ScenarioApi,
  ScenarioNotFoundError,
  ScenarioReservedSetIdError,
  scenarioTrpc,
  type RunActor,
} from "@langwatch/scenario-contract";
import { on } from "node:events";

import { filterRunsByTimestamp } from "../rules/simulation-run-timestamp-filter.rules.ts";
import { ScenarioRunRejectedError } from "../rules/scenario-run-request.rules.ts";

const logger = createLogger("langwatch:scenario:trpc");

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

/** Resolves an optional window to concrete values: the last 30 days by default. */
const resolveDateRange = (input: { startDate?: number; endDate?: number }) => ({
  startDate: input.startDate ?? Date.now() - THIRTY_DAYS_MS,
  endDate: input.endDate ?? Date.now(),
});

/** The Results tab's own window, whose end stays open on a live view. */
const resultsWindow = <Filter extends { startDate?: number }>(filter: Filter) => ({
  ...filter,
  startDate: filter.startDate ?? Date.now() - THIRTY_DAYS_MS,
});

/**
 * Refuses a run addressed into a set the platform reserves for itself.
 *
 * The internal namespace holds this project's one-off bucket and every run
 * plan's address. A run written into a plan's address is read back as that
 * plan's own history, so it would move its pass rate, its cost and its trend.
 * Only this project's own one-off address is writable here.
 */
function assertWritableSetId(params: { setId: string; projectId: string }): void {
  if (!isInternalSetId(params.setId)) return;
  if (params.setId === getOnPlatformSetId(params.projectId)) return;

  throw new ScenarioReservedSetIdError();
}

export const scenarioTrpcTransport = defineTrpcRouter(ScenarioApi, scenarioTrpc)
  // -- the cases a project defines -------------------------------------------
  .procedure("create")
  .withPermission("scenarios:manage")
  .handle(({ app, input, actor }) => app.create(input, { id: actor.id, label: "user" }))

  .procedure("getAll")
  .withPermission("scenarios:view")
  .handle(({ app, input }) => app.list(input))

  .procedure("getById")
  .withPermission("scenarios:view")
  .handle(async ({ app, input }) => {
    const scenario = await app.tryGetById(input);
    if (!scenario) throw new ScenarioNotFoundError(input.id);

    return scenario;
  })

  .procedure("getByIdIncludingArchived")
  .withPermission("scenarios:view")
  .handle(({ app, input }) => app.tryGetByIdIncludingArchived(input))

  .procedure("update")
  .withPermission("scenarios:manage")
  .handle(({ app, input, actor }) => {
    const { id, projectId, expectedVersion, ...data } = input;

    return app.update(
      { id, projectId, ...data, expectedVersion },
      { id: actor.id, label: "user" },
    );
  })

  .procedure("archive")
  .withPermission("scenarios:manage")
  .handle(({ app, input }) => app.archive(input))

  .procedure("moveToTestSuite")
  .withPermission("scenarios:manage")
  .handle(({ app, input }) =>
    app.moveToTestSuite({
      scenarioId: input.scenarioId,
      projectId: input.projectId,
      testSuiteId: input.testSuiteId,
    }),
  )

  .procedure("duplicate")
  .withPermission("scenarios:manage")
  .handle(({ app, input, actor }) =>
    app.duplicate(
      { scenarioId: input.scenarioId, projectId: input.projectId },
      { id: actor.id, label: "user" },
    ),
  )

  .procedure("batchArchive")
  .withPermission("scenarios:manage")
  .handle(({ app, input }) => app.batchArchive(input))

  // -- version history -------------------------------------------------------
  .procedure("listVersions")
  .withPermission("scenarios:view")
  .handle(async ({ app, input }) => {
    const page = await app.listVersions({
      projectId: input.projectId,
      scenarioId: input.scenarioId,
      limit: input.limit,
      cursor: input.cursor,
    });

    // The history names the person who saved each version and the store keeps
    // only their id. Resolved here rather than in the application, because a
    // display name is a concern of this list alone.
    const authorIds = [
      ...new Set(page.versions.map((version) => version.authorId).filter((id) => !!id)),
    ];
    const authors = authorIds.length > 0 ? await app.getUserProfiles({ userIds: authorIds }) : [];
    const nameById = new Map(authors.map((author) => [author.id, author.name]));

    return {
      ...page,
      versions: page.versions.map((version) => ({
        ...version,
        authorName: version.authorId ? (nameById.get(version.authorId) ?? null) : null,
      })),
    };
  })

  .procedure("getVersion")
  .withPermission("scenarios:view")
  .handle(({ app, input }) =>
    app.getVersion({
      projectId: input.projectId,
      scenarioId: input.scenarioId,
      version: input.version,
    }),
  )

  .procedure("restoreVersion")
  .withPermission("scenarios:manage")
  .handle(({ app, input, actor }) =>
    app.restoreVersion(
      {
        projectId: input.projectId,
        scenarioId: input.scenarioId,
        version: input.version,
      },
      { id: actor.id, label: "user" },
    ),
  )

  // -- running one -----------------------------------------------------------
  .procedure("run")
  .withPermission("scenarios:manage")
  .handle(async ({ app, input, actor }) => {
    const setId = input.setId ?? getOnPlatformSetId(input.projectId);
    assertWritableSetId({ setId, projectId: input.projectId });

    const batchRunId = input.batchRunId ?? generateBatchRunId();
    const runActor: RunActor = { id: actor.id, label: "user" };

    const resolved = await app
      .resolveRunParameters({
        projectId: input.projectId,
        scenarioId: input.scenarioId,
        values: input.parameters,
      })
      .catch((error: unknown) => {
        // A scenario the run names but the project does not hold is the
        // caller's mistake, and has always answered 400 here rather than the
        // 404 a direct read of that same scenario answers.
        if (error instanceof ScenarioNotFoundError) {
          throw new ScenarioRunRejectedError(error.message, { reasons: [error] });
        }
        throw error;
      });

    const prefetch = await app.prefetchExecution({
      context: {
        projectId: input.projectId,
        scenarioId: input.scenarioId,
        setId,
        batchRunId,
        parameters: resolved.parameters,
        secretParameters: resolved.secretParameters,
      },
      target: input.target,
    });

    if (!prefetch.success) {
      logger.warn(
        { projectId: input.projectId, scenarioId: input.scenarioId, error: prefetch.error },
        "Scenario validation failed",
      );
      throw new ScenarioRunRejectedError(prefetch.error);
    }

    const scenarioRunId = generateScenarioRunId();

    await app.queueSimulationRun({
      projectId: input.projectId,
      scenarioId: input.scenarioId,
      scenarioRunId,
      batchRunId,
      setId,
      name: prefetch.data.scenario.name,
      target: input.target,
      parameters: resolved.parameters,
      secretParameters: resolved.secretParameters,
      note: input.note,
      scenarioVersion: resolved.scenarioVersion,
      actor: runActor,
      resolvedModels: prefetch.resolvedModels,
    });

    // No explicit job scheduling: the execution subscriber picks the queued
    // event off the group queue and spawns the child process.
    logger.info({ batchRunId, scenarioRunId }, "Scenario queued via event-sourcing");

    return { scheduled: true, setId, batchRunId, scenarioRunId };
  })

  .procedure("cancelJob")
  .withPermission("scenarios:manage")
  .handle(({ app, input }) => app.cancelJob(input))

  .procedure("cancelBatchRun")
  .withPermission("scenarios:manage")
  .handle(({ app, input }) => app.cancelBatchRun(input))

  // -- reading what ran ------------------------------------------------------
  .procedure("getScenarioSetsData")
  .withPermission("scenarios:view")
  .handle(({ app, input }) =>
    app.getScenarioSetsData({ projectId: input.projectId, ...resolveDateRange(input) }),
  )

  .procedure("getSuiteRunData")
  .withPermission("scenarios:view")
  .handle(({ app, input }) =>
    app.readSuiteRunData({
      projectId: input.projectId,
      scenarioSetId: input.scenarioSetId,
      limit: input.limit,
      cursor: input.cursor,
      ...resolveDateRange(input),
      sinceTimestamp: input.sinceTimestamp,
    }),
  )

  .procedure("getLastResultSummaries")
  .withPermission("scenarios:view")
  .handle(({ app, input }) =>
    app.getLastResultSummaries({
      projectId: input.projectId,
      scenarioIds: input.scenarioIds,
      ...resolveDateRange(input),
    }),
  )

  .procedure("getSuiteRunFreshness")
  .withPermission("scenarios:view")
  .handle(async ({ app, input }) => ({
    lastUpdatedAt: await app.getLastUpdatedAt({
      projectId: input.projectId,
      scenarioSetId: input.scenarioSetId,
      ...resolveDateRange(input),
    }),
  }))

  .procedure("getScenarioSetRunData")
  .withPermission("scenarios:view")
  .handle(({ app, input }) =>
    app.getRunDataForScenarioSet({
      projectId: input.projectId,
      scenarioSetId: input.scenarioSetId,
      limit: input.limit,
      cursor: input.cursor,
      ...resolveDateRange(input),
    }),
  )

  .procedure("getAllScenarioSetRunData")
  .withPermission("scenarios:view")
  .handle(async ({ app, input }) => {
    const result = await app.readSuiteRunData({
      projectId: input.projectId,
      scenarioSetId: input.scenarioSetId,
      limit: 100,
      ...resolveDateRange(input),
    });

    return result.changed ? result.runs : [];
  })

  .procedure("getRunState")
  .withPermission("scenarios:view")
  .handle(async ({ app, input }) => {
    // A point lookup by unique run id, with no window, so runs older than any
    // default range stay reachable.
    const data = await app.findScenarioRunData({
      projectId: input.projectId,
      scenarioRunId: input.scenarioRunId,
    });
    if (!data) throw new NotFoundError("not_found", "Scenario run", input.scenarioRunId);

    return data;
  })

  .procedure("getScenarioSetBatchRunCount")
  .withPermission("scenarios:view")
  .handle(async ({ app, input }) => ({
    count: await app.getBatchRunCountForScenarioSet({
      projectId: input.projectId,
      scenarioSetId: input.scenarioSetId,
      ...resolveDateRange(input),
    }),
  }))

  .procedure("getScenarioSetBatchHistory")
  .withPermission("scenarios:view")
  .handle(({ app, input }) =>
    app.getBatchHistoryForScenarioSet({
      projectId: input.projectId,
      scenarioSetId: input.scenarioSetId,
      limit: input.limit,
      cursor: input.cursor,
      ...resolveDateRange(input),
    }),
  )

  .procedure("getBatchRunData")
  .withPermission("scenarios:view")
  .handle(async ({ app, input }) => {
    // A point lookup by batch run id, with no window, so an old batch stays
    // reachable when it is opened directly.
    const result = await app.getRunDataForBatchRun({
      projectId: input.projectId,
      scenarioSetId: input.scenarioSetId,
      batchRunId: input.batchRunId,
      sinceTimestamp: input.sinceTimestamp,
    });

    return filterRunsByTimestamp(result, input.runTimestamps);
  })

  .procedure("getExternalSetSummaries")
  .withPermission("scenarios:view")
  .handle(({ app, input }) =>
    app.getExternalSetSummaries({ projectId: input.projectId, ...resolveDateRange(input) }),
  )

  .procedure("getAllSuiteRunData")
  .withPermission("scenarios:view")
  .handle(({ app, input }) =>
    app.getRunDataForAllSuites({
      projectId: input.projectId,
      limit: input.limit,
      cursor: input.cursor,
      ...resolveDateRange(input),
    }),
  )

  .procedure("onSimulationUpdate")
  .withPermission("scenarios:view")
  .handle(async function* ({ app, input, signal }) {
    const { projectId, tabKey, tabId } = input;
    const emitter = app.tenantEmitter(projectId);

    logger.info({ projectId }, "Simulation run stream started");

    const presence =
      tabKey && tabId ? await app.startTabPresence({ projectId, tabKey, tabId }) : null;

    if (presence?.parkedNavigate) {
      // The same envelope the broadcast path emits, so the client parses one
      // shape rather than two.
      yield { event: JSON.stringify(presence.parkedNavigate), timestamp: Date.now() };
    }

    try {
      for await (const eventArgs of on(emitter, "simulation_updated", { signal })) {
        yield eventArgs[0];
      }
    } catch (error) {
      // A disconnect aborts the wait, which is the normal end of a stream and
      // not something to answer as a stream error.
      if ((error as { name?: string })?.name !== "AbortError") throw error;
    } finally {
      await presence?.stop();
    }
  })

  // -- the Results tab -------------------------------------------------------
  .procedure("getCodeScenarios")
  .withPermission("scenarios:view")
  .handle(({ app, input }) =>
    app.getCodeScenarios({
      projectId: input.projectId,
      startDate: input.startDate ?? Date.now() - THIRTY_DAYS_MS,
      endDate: input.endDate,
    }),
  )

  .procedure("getRunTargets")
  .withPermission("scenarios:view")
  .handle(({ app, input }) =>
    app.getRunTargets({
      projectId: input.projectId,
      startDate: input.startDate ?? Date.now() - THIRTY_DAYS_MS,
      endDate: input.endDate,
    }),
  )

  .procedure("getResultsOverview")
  .withPermission("scenarios:view")
  .handle(({ app, input }) => {
    const { groupBy, ...filter } = input;

    return app.getResultsOverview({ filter: resultsWindow(filter), groupBy });
  })

  .procedure("getResultAtoms")
  .withPermission("scenarios:view")
  .handle(({ app, input }) => {
    const { limit, cursor, ...filter } = input;

    return app.getResultAtoms({ filter: resultsWindow(filter), limit, cursor });
  })

  .procedure("getRunConfigurations")
  .withPermission("scenarios:view")
  .handle(({ app, input }) => app.getRunConfigurations(input))
  .build();
