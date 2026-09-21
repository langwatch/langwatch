/**
 * The counts behind the usage report's optional block (ADR-139, section 10).
 *
 * Every one of these is a `count` or a `min` over a column the install already
 * holds. None of them reads a name, a body or an address: what comes back is a
 * number or a date.
 *
 * Each figure is taken lifetime and over the two windows, because the lifetime
 * total on its own answers almost nothing. An install that ingested a million
 * traces two years ago and none since reads exactly like one ingesting a
 * million a week.
 */

import type { PrismaClient } from "~/generated/prisma/client";
import { BUILDER_CHART_KIND } from "~/server/analytics/chartKinds";

const DAY_MS = 24 * 60 * 60 * 1000;

/** The two stretches every windowed count is taken over. */
export function windowStarts(now: Date): {
  sevenDays: Date;
  twentyEight: Date;
} {
  return {
    sevenDays: new Date(now.getTime() - 7 * DAY_MS),
    twentyEight: new Date(now.getTime() - 28 * DAY_MS),
  };
}

/** What a model has to offer to be counted here. */
interface CountableModel {
  count(args: unknown): Promise<number>;
}

/** One figure, lifetime and over both windows, under its dictionary keys. */
export async function countedInWindows({
  key,
  model,
  projectIds,
  now,
  lifetimeKey,
  extraWhere,
}: {
  key: string;
  model: CountableModel;
  projectIds: string[];
  now: Date;
  lifetimeKey?: string;
  extraWhere?: Record<string, unknown>;
}): Promise<Record<string, number>> {
  const scope = { projectId: { in: projectIds }, ...(extraWhere ?? {}) };
  const { sevenDays, twentyEight } = windowStarts(now);

  const [lifetime, sevenDayCount, twentyEightCount] = await Promise.all([
    model.count({ where: scope }),
    model.count({ where: { ...scope, createdAt: { gte: sevenDays } } }),
    model.count({ where: { ...scope, createdAt: { gte: twentyEight } } }),
  ]);

  return {
    [lifetimeKey ?? key]: lifetime,
    [`${key}_7d`]: sevenDayCount,
    [`${key}_28d`]: twentyEightCount,
  };
}

/**
 * The oldest row of a model, as the day that rung of the ladder was reached.
 *
 * Null where it never was, which is the answer worth having: the rungs an
 * install never reached are what say where getting started stalls.
 */
async function firstAt({
  model,
  projectIds,
}: {
  model: { findFirst(args: unknown): Promise<{ createdAt: Date } | null> };
  projectIds: string[];
}): Promise<string | null> {
  const row = await model.findFirst({
    where: { projectId: { in: projectIds } },
    orderBy: { createdAt: "asc" },
    select: { createdAt: true },
  });
  return row?.createdAt.toISOString() ?? null;
}

/** The figures taken lifetime and over both windows. */
async function windowedCounts({
  prisma,
  projectIds,
  now,
}: {
  prisma: PrismaClient;
  projectIds: string[];
  now: Date;
}): Promise<Record<string, number>> {
  const of = (
    key: string,
    model: CountableModel,
    lifetimeKey?: string,
  ): Promise<Record<string, number>> =>
    countedInWindows({
      key,
      model,
      projectIds,
      now,
      ...(lifetimeKey ? { lifetimeKey } : {}),
    });

  const counted = await Promise.all([
    of("annotations", prisma.annotation),
    of("batch_evaluations", prisma.batchEvaluation, "batchEvaluations"),
    of("datasets", prisma.dataset),
    of("dataset_records", prisma.datasetRecord, "datasetRecords"),
    of("experiments", prisma.experiment),
    of("prompts", prisma.llmPromptConfig),
    of("monitors", prisma.monitor),
    of("workflows", prisma.workflow),
    of("triggers", prisma.trigger),
  ]);
  return Object.assign({}, ...counted);
}

/** The figures that are only ever a lifetime total. */
async function lifetimeCounts({
  prisma,
  projectIds,
}: {
  prisma: PrismaClient;
  projectIds: string[];
}): Promise<Record<string, number>> {
  const scope = { projectId: { in: projectIds } };
  const [
    annotationQueues,
    annotationQueueItems,
    annotationScores,
    customGraphs,
  ] = await Promise.all([
    prisma.annotationQueue.count({ where: scope }),
    prisma.annotationQueueItem.count({ where: scope }),
    prisma.annotationScore.count({ where: scope }),
    // Builder charts only, so the figure keeps meaning what it has always
    // meant. Saved workbench charts share the table but are a different
    // product; folding them in would show as growth in chart-builder usage.
    prisma.customGraph.count({
      where: { ...scope, kind: BUILDER_CHART_KIND },
    }),
  ]);

  return {
    annotationQueues,
    annotationQueueItems,
    annotationScores,
    customGraphs,
  };
}

/** Every count the install's own database can answer. */
export async function storedCounts({
  prisma,
  projectIds,
  now,
}: {
  prisma: PrismaClient;
  projectIds: string[];
  now: Date;
}): Promise<Record<string, number>> {
  const [windowed, lifetime] = await Promise.all([
    windowedCounts({ prisma, projectIds, now }),
    lifetimeCounts({ prisma, projectIds }),
  ]);
  return { ...lifetime, ...windowed };
}

/** The day each rung of getting started was first reached, or null. */
export async function onboardingLadder({
  prisma,
  projectIds,
}: {
  prisma: PrismaClient;
  projectIds: string[];
}): Promise<Record<string, string | null>> {
  const [
    firstProject,
    firstDataset,
    firstEvaluation,
    firstMonitor,
    firstPrompt,
    firstWorkflow,
    firstModelProvider,
    firstAnnotation,
    firstTrigger,
    firstExperiment,
    secondMember,
  ] = await Promise.all([
    prisma.project
      .findFirst({
        where: { id: { in: projectIds } },
        orderBy: { createdAt: "asc" },
        select: { createdAt: true },
      })
      .then((row) => row?.createdAt.toISOString() ?? null),
    firstAt({ model: prisma.dataset, projectIds }),
    firstAt({ model: prisma.batchEvaluation, projectIds }),
    firstAt({ model: prisma.monitor, projectIds }),
    firstAt({ model: prisma.llmPromptConfig, projectIds }),
    firstAt({ model: prisma.workflow, projectIds }),
    firstAt({ model: prisma.modelProvider, projectIds }),
    firstAt({ model: prisma.annotation, projectIds }),
    firstAt({ model: prisma.trigger, projectIds }),
    firstAt({ model: prisma.experiment, projectIds }),
    // The second membership, not the first: the first is whoever installed it,
    // and an install becomes a team on the second.
    prisma.organizationUser
      .findMany({
        orderBy: { createdAt: "asc" },
        take: 2,
        select: { createdAt: true },
      })
      .then((rows) => rows[1]?.createdAt.toISOString() ?? null),
  ]);

  return {
    first_project_at: firstProject,
    first_member_at: secondMember,
    first_dataset_at: firstDataset,
    first_evaluation_at: firstEvaluation,
    first_monitor_at: firstMonitor,
    first_prompt_at: firstPrompt,
    first_workflow_at: firstWorkflow,
    first_model_provider_at: firstModelProvider,
    first_annotation_at: firstAnnotation,
    first_trigger_at: firstTrigger,
    first_experiment_at: firstExperiment,
  };
}

/**
 * The company running this install, as domains with counts.
 *
 * The part after the `@`, counted, and nothing else: no address, no name, no
 * individual. `acme.com: 14` says who to support and who to talk to, and says
 * nothing about anyone in particular.
 *
 * The split and the count happen in Postgres, so no address is ever read into
 * the application process. On an install with tens of thousands of users that
 * is the difference between a grouped scan and materialising every address in
 * memory once a day, and it is what lets the docs page say the report is built
 * without the addresses being handled.
 */
export async function userEmailDomains(
  prisma: PrismaClient,
): Promise<Record<string, number>> {
  const rows = await prisma.$queryRaw<{ domain: string; count: number }[]>`
    -- @tenancy: the usage report describes the whole install, so this counts
    -- every user on it rather than one tenant's. No address leaves Postgres.
    SELECT split_part(lower(trim("email")), '@', 2) AS domain,
           count(*)::int AS count
      FROM "User"
     WHERE "email" IS NOT NULL
     GROUP BY 1
  `;

  const counts: Record<string, number> = {};
  for (const row of rows) {
    if (!row.domain) continue;
    counts[row.domain] = (counts[row.domain] ?? 0) + row.count;
  }
  return counts;
}

/** What is running rather than what is stored. */
export async function activityCounts({
  prisma,
  projectIds,
  now,
}: {
  prisma: PrismaClient;
  projectIds: string[];
  now: Date;
}): Promise<Record<string, number>> {
  const { twentyEight } = windowStarts(now);

  const [sessions, activeProjects] = await Promise.all([
    // A session that has not expired yet was minted inside its own lifetime,
    // so an unexpired session is somebody who signed in recently. Counted by
    // user, so one person on four devices is one person.
    prisma.session.findMany({
      where: { expires: { gte: now } },
      select: { userId: true },
      distinct: ["userId"],
    }),
    prisma.project.count({
      where: { id: { in: projectIds }, updatedAt: { gte: twentyEight } },
    }),
  ]);

  return {
    active_users_28d: sessions.length,
    active_projects_28d: activeProjects,
  };
}
