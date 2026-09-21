/**
 * The counts behind the usage report's optional block (ADR-141, section 10).
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
  scope,
  now,
  lifetimeKey,
  dateField = "createdAt",
}: {
  key: string;
  model: CountableModel;
  /** The rows that belong to this install: a project or organization scope. */
  scope: Record<string, unknown>;
  now: Date;
  lifetimeKey?: string;
  /** The column a window is cut on, where it is not the row's own creation. */
  dateField?: string;
}): Promise<Record<string, number>> {
  const { sevenDays, twentyEight } = windowStarts(now);

  const [lifetime, sevenDayCount, twentyEightCount] = await Promise.all([
    model.count({ where: scope }),
    model.count({ where: { ...scope, [dateField]: { gte: sevenDays } } }),
    model.count({ where: { ...scope, [dateField]: { gte: twentyEight } } }),
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
  organizationIds,
  now,
}: {
  prisma: PrismaClient;
  projectIds: string[];
  organizationIds: string[];
  now: Date;
}): Promise<Record<string, number>> {
  const scope = { projectId: { in: projectIds } };
  const of = (
    key: string,
    model: CountableModel,
    lifetimeKey?: string,
  ): Promise<Record<string, number>> =>
    countedInWindows({
      key,
      model,
      scope,
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
    // Pull requests hang off the organization, and are windowed by the day
    // the pull request was opened rather than the day this install noticed
    // it: a backfill of last year's pull requests is not last week's work.
    countedInWindows({
      key: "pull_requests",
      model: prisma.githubPullRequest,
      scope: { organizationId: { in: organizationIds } },
      now,
      dateField: "prCreatedAt",
    }),
    langyCounts({ prisma, projectIds, now }),
  ]);
  return Object.assign({}, ...counted);
}

/**
 * Langy, from its Postgres projections. Turns are rows of the turn
 * projection; people are distinct owners of conversations, counted in
 * Postgres by grouping, so twenty conversations of one person are one person.
 *
 * The projections stamp their times as epoch milliseconds, which is why the
 * windows are numbers here and dates everywhere else.
 */
async function langyCounts({
  prisma,
  projectIds,
  now,
}: {
  prisma: PrismaClient;
  projectIds: string[];
  now: Date;
}): Promise<Record<string, number>> {
  const scope = { projectId: { in: projectIds } };
  const { sevenDays, twentyEight } = windowStarts(now);

  const turnsSince = (since?: Date) =>
    prisma.langyConversationTurnProjection.count({
      where: {
        ...scope,
        ...(since ? { CreatedAt: { gte: since.getTime() } } : {}),
      },
    });

  // A conversation is active when its last activity falls in the window; a
  // conversation opened in the window and never stamped is active too.
  const usersSince = (since?: Date) =>
    prisma.langyConversationProjection
      .groupBy({
        by: ["UserId"],
        where: {
          ...scope,
          ...(since
            ? {
                OR: [
                  { LastActivityAt: { gte: since.getTime() } },
                  { CreatedAt: { gte: since.getTime() } },
                ],
              }
            : {}),
        },
      })
      .then((rows) => rows.length);

  const [turns, turns7d, turns28d, users, users7d, users28d] =
    await Promise.all([
      turnsSince(),
      turnsSince(sevenDays),
      turnsSince(twentyEight),
      usersSince(),
      usersSince(sevenDays),
      usersSince(twentyEight),
    ]);

  return {
    langy_turns: turns,
    langy_turns_7d: turns7d,
    langy_turns_28d: turns28d,
    langy_users: users,
    langy_active_users_7d: users7d,
    langy_active_users_28d: users28d,
  };
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
  organizationIds,
  now,
}: {
  prisma: PrismaClient;
  projectIds: string[];
  organizationIds: string[];
  now: Date;
}): Promise<Record<string, number>> {
  const [windowed, lifetime] = await Promise.all([
    windowedCounts({ prisma, projectIds, organizationIds, now }),
    lifetimeCounts({ prisma, projectIds }),
  ]);
  return { ...lifetime, ...windowed };
}

/**
 * The first model provider, asked one organization at a time.
 *
 * A provider lives on the organization, and the tenancy guard on that model
 * admits one organization id per read rather than a list, so the install's
 * organizations are read in turn and the earliest wins.
 */
async function firstModelProviderAt({
  prisma,
  organizationIds,
}: {
  prisma: PrismaClient;
  organizationIds: string[];
}): Promise<string | null> {
  const rows = await Promise.all(
    organizationIds.map((organizationId) =>
      prisma.modelProvider.findFirst({
        where: { organizationId },
        orderBy: { createdAt: "asc" },
        select: { createdAt: true },
      }),
    ),
  );
  const reached = rows
    .filter((row): row is { createdAt: Date } => row !== null)
    .map((row) => row.createdAt.getTime());
  return reached.length === 0
    ? null
    : new Date(Math.min(...reached)).toISOString();
}

/** The day each rung of getting started was first reached, or null. */
export async function onboardingLadder({
  prisma,
  projectIds,
  organizationIds,
}: {
  prisma: PrismaClient;
  projectIds: string[];
  organizationIds: string[];
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
    firstLangyTurn,
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
    firstModelProviderAt({ prisma, organizationIds }),
    firstAt({ model: prisma.annotation, projectIds }),
    firstAt({ model: prisma.trigger, projectIds }),
    firstAt({ model: prisma.experiment, projectIds }),
    // The second membership, not the first: the first is whoever installed it,
    // and an install becomes a team on the second.
    prisma.organizationUser
      .findMany({
        where: { organizationId: { in: organizationIds } },
        orderBy: { createdAt: "asc" },
        take: 2,
        select: { createdAt: true },
      })
      .then((rows) => rows[1]?.createdAt.toISOString() ?? null),
    // The turn projection stamps epoch milliseconds, not a date.
    prisma.langyConversationTurnProjection
      .findFirst({
        where: { projectId: { in: projectIds } },
        orderBy: { CreatedAt: "asc" },
        select: { CreatedAt: true },
      })
      .then((row) => (row ? new Date(row.CreatedAt).toISOString() : null)),
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
    first_langy_turn_at: firstLangyTurn,
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
