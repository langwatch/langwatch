/**
 * The Instant Eval run, wired from the environment.
 *
 * ## Why the service is cached here rather than on the application container
 *
 * The house rule is that a server-side caller obtains a service from
 * `getApp()`. This slice keeps a local cache with a test-only setter, for the
 * same reason `~/server/analytics/lwql` does and it is the same constraint:
 * `App`'s fields are readonly and it is built once, so a suite that wants a
 * fake classifier or a fake row source would have to tear the whole container
 * down and rebuild it, closing the event-sourcing and Redis handles the rest of
 * the file still needs. Migrating both slices onto the container is one change
 * to `dependencies.ts`, `presets.ts` and `app.ts`, not a late edit to this one.
 *
 * The setter is reachable from anything importing this module, and that is a
 * real cost: nothing but a test should ever call it.
 *
 * @see ./instant-eval-run.service.ts
 */

import { getLangWatchQLService } from "~/server/analytics/lwql";
import { lwqlConnectionFromEnv } from "~/server/analytics/lwql/executor";
import { getProtectionsForProject } from "~/server/api/utils";
import { getApp, tryGetApp } from "~/server/app-layer/app";
import { translateFilterToClickHouse } from "~/server/app-layer/traces/filter-to-clickhouse";
import { explorerHiddenOrigins } from "~/server/app-layer/traces/hidden-origins";
import { prisma } from "~/server/db";
import { instantEvalsEnabled } from "../access";
import { getInstantEvalClassifier } from "../classifier";
import type { InstantEvalSpendRecorder } from "../instant-eval-spend.recorder";
import { createInstantEvalFreeBudgetFromEnv } from "../spend";
import {
  createInstantEvalCancellations,
  type InstantEvalCancellationRedis,
} from "./cancellation";
import type { InstantEvalJudgmentsRepository } from "./instant-eval-judgments.repository";
import { createInstantEvalRunExecutor } from "./instant-eval-run.executor";
import type { InstantEvalRunRepository } from "./instant-eval-run.repository";
import {
  type InstantEvalRunCommands,
  InstantEvalRunService,
} from "./instant-eval-run.service";
import { queryCapabilityOf } from "./query-capability";
import { createInstantEvalRowSource } from "./row-source";

/**
 * Classifications one page keeps in flight.
 *
 * The same hundred and twenty-eight the synchronous path uses, and for the
 * same reason: the token bucket paces the deployment, and this only has to be
 * high enough that the bucket, not the number of open requests, is what a page
 * waits on. At about 250 ms a call, thirty-two in flight could never reach the
 * bucket's rate on ordinary texts.
 */
const INSTANT_EVAL_PAGE_CONCURRENCY = 128;

async function callerFor(projectId: string) {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { id: true, lwqlKey: true },
  });
  return queryCapabilityOf({
    project,
    hasDeploymentIdentity: lwqlConnectionFromEnv() !== null,
  });
}

/** The plan that caps this project's runs. */
async function planFor(projectId: string) {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { team: { select: { organizationId: true } } },
  });
  const organizationId = project?.team?.organizationId;
  if (!organizationId) return { name: "free", isFree: true };
  const plan = await getApp().planProvider.getActivePlan({ organizationId });
  return { name: plan.name, isFree: plan.free };
}

function cancellations() {
  return createInstantEvalCancellations(
    (tryGetApp()?.redis as InstantEvalCancellationRedis | undefined) ?? null,
  );
}

/**
 * The run port the pipeline drives, built from the environment.
 *
 * Called by the registry while the application container is being built, so it
 * resolves nothing at call time that is not available yet: every dependency it
 * names is either a module-level client, a function it defers, or a repository
 * the composition root already built. The two stores are the third kind:
 * ClickHouse is reached through repositories the App hands out, never through
 * a client this module resolves, and the spend recorder is whatever the root
 * bound.
 */
export function createInstantEvalRunPortFromEnv({
  runs,
  judgments,
  spend,
}: {
  runs: InstantEvalRunRepository;
  judgments: InstantEvalJudgmentsRepository;
  spend: InstantEvalSpendRecorder;
}) {
  return createInstantEvalRunExecutor({
    runs,
    judgments,
    rowSource: createInstantEvalRowSource(),
    classifier: getInstantEvalClassifier,
    spendRecorder: spend,
    projectKey: async (projectId) =>
      (await callerFor(projectId))?.lwqlKey ?? null,
    maxConcurrency: INSTANT_EVAL_PAGE_CONCURRENCY,
    protections: (projectId) => getProtectionsForProject(prisma, { projectId }),
    isCancelled: ({ runId }) => cancellations().isRequested({ runId }),
    assertWithinBudget: ({ projectId, runId, inFlightUsd }) =>
      createInstantEvalFreeBudgetFromEnv().assertWithinBudget({
        projectId,
        inFlightUsd,
        reservationId: runId,
      }),
    releaseBudget: ({ projectId, runId }) =>
      createInstantEvalFreeBudgetFromEnv().release({
        projectId,
        reservationId: runId,
      }),
  });
}

let cached: InstantEvalRunService | null = null;

/** The process-wide run service, built from the environment on first use. */
export function getInstantEvalRunService(): InstantEvalRunService {
  cached ??= new InstantEvalRunService({
    runs: getApp().instantEvals.runs,
    judgments: getApp().instantEvals.judgments,
    rowSource: createInstantEvalRowSource(),
    query: getLangWatchQLService(),
    classifier: getInstantEvalClassifier,
    commands: () =>
      getApp().commands.instantEvals as unknown as InstantEvalRunCommands,
    cancellations: cancellations(),
    isEnabled: ({ projectId }) => instantEvalsEnabled({ prisma, projectId }),
    caller: callerFor,
    plan: planFor,
    budget: createInstantEvalFreeBudgetFromEnv(),
    selectTraceIds: selectExplorerTraceIds,
  });
  return cached;
}

/**
 * The trace ids a filter selects, through the Explorer's own compiler: the
 * same predicate the table shows, hidden origins left out, newest first and
 * capped at the run's row limit.
 */
async function selectExplorerTraceIds({
  projectId,
  filter,
  window,
  limit,
}: {
  projectId: string;
  filter: string;
  window: { from: number; to: number };
  limit: number;
}): Promise<readonly string[]> {
  return await getApp().traces.list.getTraceIds({
    tenantId: projectId,
    timeRange: window,
    filterWhere:
      translateFilterToClickHouse(filter, projectId, window) ?? undefined,
    hiddenOrigins: explorerHiddenOrigins(filter),
    limit,
  });
}

/**
 * Replaces the process-wide run service, or clears it.
 *
 * **Tests only.** Where a suite wires a fake classifier and a fake row
 * source through.
 */
export function setInstantEvalRunService(
  service: InstantEvalRunService | null,
): void {
  cached = service;
}

export {
  INSTANT_EVAL_DEFAULT_ROW_CAP,
  INSTANT_EVAL_MAX_ROW_CAP,
  INSTANT_EVAL_RESULTS_CEILING,
  INSTANT_EVAL_SAMPLE_CEILING,
} from "./caps";
export type { InstantEvalEstimate } from "./instant-eval-estimate";
export {
  INSTANT_EVAL_EXPLORER_STATUSES,
  type InstantEvalExplorerRun,
  type InstantEvalExplorerStatus,
  isInstantEvalRunActive,
  toInstantEvalExplorerRun,
} from "./instant-eval-explorer";
export type {
  InstantEvalJudgment,
  InstantEvalJudgmentPage,
} from "./instant-eval-judgments.repository";
export type {
  InstantEvalRunCommands,
  InstantEvalRunInput,
} from "./instant-eval-run.service";
export { InstantEvalRunService } from "./instant-eval-run.service";
export { INSTANT_EVAL_JUDGMENT_STATUSES } from "./judgments";
