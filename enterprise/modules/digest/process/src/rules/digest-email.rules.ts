// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/** What one person's weekly email says: the rows' input read off the week, and the email's props. */
import type { DigestTestTemplate } from "@langwatch/enterprise-digest-contract";
import type { UsageStats } from "@langwatch/entitlement-contract";
import type {
  DigestWeekEvaluator,
  DigestWeekFoldedRow,
  DigestWeekProps,
  DigestWeekRow,
} from "@langwatch/mail";

import {
  type DigestFoldedRow,
  type DigestRow,
  type DigestRowCounts,
  type DigestRowsEvaluator,
  type DigestRowsInput,
  type DigestRowsProject,
  selectDigestRows,
} from "./digest-rows.rules.ts";
import {
  BASELINE_WEEKS,
  daysUntilNextMonth,
  nextMonthLabel,
  type OutcomeCounts,
  type ProjectWeek,
  type ProjectWeekState,
  userWeekTotals,
  type UserWeekState,
  weekLabel,
  weeksBefore,
} from "./digest-week.rules.ts";

/** The one template's props, typed by `@langwatch/mail`'s own props type. */
export type DigestTemplateProps = Readonly<{ templateId: "digest-week"; props: DigestWeekProps }>;

/** A visible project's name and the slug its links are built on, read when the email is built. */
export type DigestProjectName = Readonly<{ name: string; slug: string }>;

/** The month's count against a finite plan limit; null when the plan has none to press on. */
export type PlanUsage = Readonly<{ used: number; limit: number }>;

/** One organization's finished week: its folds and its plan usage, read once. */
export type OrganizationWeek = Readonly<{
  organizationId: string;
  isoWeek: string;
  planUsage: PlanUsage | null;
  /** Each project's fold for the week. */
  projects: readonly ProjectWeek[];
  /** Each project's folds for the weeks before it, as far back as the baseline reads. */
  history: readonly ProjectWeekState[];
  /** Each visible project's traces the week before; a project absent from it failed that read. */
  previousTraces: ReadonlyMap<string, number>;
  users: ReadonlyMap<string, UserWeekState>;
}>;

/** Multiplied before dividing, so 900 of 1,000 reads exactly 90. */
const percentOf = ({ part, whole }: { part: number; whole: number }): number =>
  whole > 0 ? (part * 100) / whole : 0;

/**
 * A person's week in one organization: the `DigestSend` row's id, so only the first claim of it
 * lands, the send aggregate's id, and the send an unsubscribe records it came from. The
 * organization is part of it, so a person in three organizations has three distinct sends.
 */
export function digestSendKey({
  userId,
  organizationId,
  isoWeek,
}: {
  userId: string;
  organizationId: string;
  isoWeek: string;
}): string {
  return `${userId}:${organizationId}:${isoWeek}`;
}

/** The idempotency key a member's week is sent under: a retry is not a second email. */
export function digestMessageId(week: Parameters<typeof digestSendKey>[0]): string {
  return `digest:${digestSendKey(week)}`;
}

/** An uncapped plan reports its limit as MAX_SAFE_INTEGER (entitlement's contract). */
export function derivePlanUsage(
  usage: Pick<UsageStats, "currentMonthMessagesCount" | "maxMonthlyUsageLimit">,
): PlanUsage | undefined {
  const limit = usage.maxMonthlyUsageLimit;
  if (usage.currentMonthMessagesCount === null || limit <= 0 || limit >= Number.MAX_SAFE_INTEGER) {
    return undefined;
  }
  return { used: usage.currentMonthMessagesCount, limit };
}

const NO_COUNTS: DigestRowCounts = { total: 0, failed: 0 };
const NO_OUTCOMES: OutcomeCounts = { runs: 0, passed: 0, failed: 0 };

const addCounts = (left: DigestRowCounts, right: DigestRowCounts): DigestRowCounts => ({
  total: left.total + right.total,
  failed: left.failed + right.failed,
});

/** Scenarios count every run; a run that neither passed nor failed still ran. */
const runsOf = ({ runs, failed }: OutcomeCounts): DigestRowCounts => ({ total: runs, failed });

/** Evals count only checks that passed or failed; a skipped one checked nothing. */
const checksOf = ({ passed, failed }: OutcomeCounts): DigestRowCounts => ({
  total: passed + failed,
  failed,
});

// Own keys only: an evaluator named `constructor` must not read the prototype's.
const outcomesOf = (record: Readonly<Record<string, OutcomeCounts>>, key: string) =>
  (Object.hasOwn(record, key) ? record[key] : undefined) ?? NO_OUTCOMES;

/** The project's folds for the four weeks before the sent one; a week with none is absent. */
function baselineFoldsOf({
  week,
  projectId,
}: {
  week: OrganizationWeek;
  projectId: string;
}): ProjectWeekState[] {
  const before = new Set(weeksBefore({ isoWeek: week.isoWeek, count: BASELINE_WEEKS }));
  return week.history.filter((fold) => fold.projectId === projectId && before.has(fold.isoWeek));
}

/** Each evaluator that ran this week or in the baseline: its checks, the baseline's summed. */
function evaluatorsOf({
  project,
  baseline,
}: {
  project: ProjectWeek;
  baseline: readonly ProjectWeekState[];
}): DigestRowsEvaluator[] {
  const types = new Set([
    ...Object.keys(project.evaluators),
    ...baseline.flatMap((fold) => Object.keys(fold.evaluators)),
  ]);
  return [...types].map((evaluatorType) => ({
    evaluatorType,
    week: checksOf(outcomesOf(project.evaluators, evaluatorType)),
    baseline: baseline
      .map((fold) => checksOf(outcomesOf(fold.evaluators, evaluatorType)))
      .reduce(addCounts, NO_COUNTS),
  }));
}

const evaluationRunsOf = (folds: readonly ProjectWeekState[]): number =>
  folds
    .flatMap((fold) => Object.values(fold.evaluators))
    .reduce((total, counts) => total + counts.runs, 0);

/** What the row rules read for one member of the organization. */
export function digestRowsInput({
  week,
  userId,
  admin,
  mode,
}: {
  week: OrganizationWeek;
  userId: string;
  admin: boolean;
  mode: DigestTestTemplate;
}): DigestRowsInput {
  const user = week.users.get(userId);
  return {
    mode,
    admin,
    plan: week.planUsage,
    codingAgentSessions: user ? userWeekTotals(user).sessions : 0,
    projects: week.projects.map((project): DigestRowsProject => {
      const baseline = baselineFoldsOf({ week, projectId: project.projectId });
      return {
        projectId: project.projectId,
        traces: project.traces,
        previousTraces: week.previousTraces.get(project.projectId) ?? null,
        scenarios: runsOf(project.scenarios),
        scenarioBaseline: baseline
          .map((fold) => runsOf(fold.scenarios))
          .reduce(addCounts, NO_COUNTS),
        evaluators: evaluatorsOf({ project, baseline }),
        evaluationRuns: evaluationRunsOf([project, ...baseline]),
      };
    }),
  };
}

const CUSTOM: DigestWeekEvaluator = { kind: "custom" };

/**
 * A catalogue evaluator named from its type (`ragas/faithfulness` reads "faithfulness"); a
 * custom or workflow one is custom, since its type carries an id rather than a name.
 */
export function evaluatorOf(evaluatorType: string): DigestWeekEvaluator {
  const [family = "", ...rest] = evaluatorType.split("/");
  if (rest.length === 0 || ["custom", "evaluators", "workflow"].includes(family)) return CUSTOM;
  const name = rest.join(" ").replaceAll(/[_-]+/g, " ").trim();
  return name ? { kind: "catalogue", name } : CUSTOM;
}

type RowContext = Readonly<{
  week: OrganizationWeek;
  userId: string;
  projects: ReadonlyMap<string, DigestProjectName>;
  baseUrl: string;
  now: number;
}>;

/** A row's props, or none when what it shows cannot be read, such as a project's name. */
function foldableMailRows({
  row,
  context,
}: {
  row: DigestFoldedRow;
  context: RowContext;
}): DigestWeekFoldedRow[] {
  const { week, userId, projects, baseUrl, now } = context;
  if (row.kind === "plan") {
    const usage = week.planUsage;
    if (!usage) return [];
    return [
      {
        kind: "plan",
        used: usage.used,
        limit: usage.limit,
        daysLeft: daysUntilNextMonth(now),
        resetsOn: nextMonthLabel(now),
        url: `${baseUrl}/settings/usage`,
        upgradeUrl: `${baseUrl}/settings/subscription`,
      },
    ];
  }
  if (row.kind === "coding") {
    const user = week.users.get(userId);
    return user ? codingRows({ user, baseUrl }) : [];
  }
  const project = projects.get(row.projectId);
  if (!project) return [];
  if (row.kind === "traces") {
    const fold = week.projects.find(({ projectId }) => projectId === row.projectId);
    return fold ? [tracesRow({ week, fold, project, baseUrl })] : [];
  }
  return [projectRow({ row, project, baseUrl })];
}

function projectRow({
  row,
  project,
  baseUrl,
}: {
  row: Extract<DigestFoldedRow, { kind: "scenarios" | "evals" | "quiet" | "setup" }>;
  project: DigestProjectName;
  baseUrl: string;
}): DigestWeekFoldedRow {
  const projectUrl = `${baseUrl}/${project.slug}`;
  switch (row.kind) {
    case "scenarios":
      return {
        kind: "scenarios",
        direction: row.direction,
        projectName: project.name,
        runs: row.week.total,
        failed: row.week.failed,
        baselineFailurePercent: percentOf({ part: row.baseline.failed, whole: row.baseline.total }),
        url: `${projectUrl}/simulations/scenarios`,
      };
    case "evals":
      return {
        kind: "evals",
        direction: row.direction,
        projectName: project.name,
        evaluator: evaluatorOf(row.evaluatorType),
        checks: row.week.total,
        failed: row.week.failed,
        baselinePassPercent: percentOf({
          part: row.baseline.total - row.baseline.failed,
          whole: row.baseline.total,
        }),
        url: `${projectUrl}/online-evaluations`,
      };
    case "quiet":
      return {
        kind: "quiet",
        projectName: project.name,
        previousTraces: row.previousTraces,
        url: `${projectUrl}/traces`,
      };
    case "setup":
      return { kind: "setup", projectName: project.name, url: `${projectUrl}/online-evaluations` };
  }
}

/** The reader's own coding agents: counts only, never what they cost. */
function codingRows({
  user,
  baseUrl,
}: {
  user: UserWeekState;
  baseUrl: string;
}): DigestWeekFoldedRow[] {
  const totals = userWeekTotals(user);
  if (totals.sessions === 0) return [];
  const [topRepository] = Object.entries(user.repositories).toSorted(
    ([, left], [, right]) => right - left,
  );
  return [
    {
      kind: "coding",
      sessions: totals.sessions,
      tokens: totals.tokens,
      ...(totals.commits > 0 ? { commits: totals.commits } : {}),
      ...(totals.pullRequests > 0 ? { pullRequests: totals.pullRequests } : {}),
      ...(topRepository && topRepository[1] > 0
        ? { topRepository: { name: topRepository[0], sessions: topRepository[1] } }
        : {}),
      totalsAtLeast: totals.atLeast,
      url: baseUrl,
    },
  ];
}

function tracesRow({
  week,
  fold,
  project,
  baseUrl,
}: {
  week: OrganizationWeek;
  fold: ProjectWeek;
  project: DigestProjectName;
  baseUrl: string;
}): DigestWeekFoldedRow {
  const previous = week.previousTraces.get(fold.projectId);
  const [topModel] = Object.entries(fold.models).toSorted(([, left], [, right]) => right - left);
  return {
    kind: "traces",
    projectName: project.name,
    traces: fold.traces,
    ...(previous === undefined ? {} : { previousTraces: previous }),
    errors: fold.errors,
    costUsd: fold.costUsd,
    p95Milliseconds: Math.round(fold.p95Ms),
    ...(topModel ? { topModel: { name: topModel[0], traces: topModel[1] } } : {}),
    url: `${baseUrl}/${project.slug}/traces`,
  };
}

function mailRows({ row, context }: { row: DigestRow; context: RowContext }): DigestWeekRow[] {
  if (row.kind !== "new") return foldableMailRows({ row, context });
  const project = context.projects.get(row.projectId);
  if (!project) return [];
  return [
    {
      kind: "new",
      projectName: project.name,
      url: `${context.baseUrl}/${project.slug}/simulations/scenarios`,
    },
  ];
}

/**
 * The person's email for one organization (`@langwatch/mail` digest-week.tsx), its links built
 * on the deployment's origin; none when no row but New has something to say, so nothing is sent.
 * A row whose project has no name is left out rather than shown nameless.
 */
export function buildDigestWeekProps({
  week,
  userId,
  admin,
  mode,
  organizationName,
  projects,
  baseUrl,
  preferencesUrl,
  now,
}: {
  week: OrganizationWeek;
  userId: string;
  admin: boolean;
  mode: DigestTestTemplate;
  organizationName: string | null;
  projects: ReadonlyMap<string, DigestProjectName>;
  baseUrl: string;
  /** The email-preferences page the footer link opens. */
  preferencesUrl: string;
  now: number;
}): DigestWeekProps | undefined {
  const selection = selectDigestRows(digestRowsInput({ week, userId, admin, mode }));
  const context: RowContext = { week, userId, projects, baseUrl, now };
  const rows = selection.shown.flatMap((row) => mailRows({ row, context }));
  if (!rows.some((row) => row.kind !== "new")) return undefined;
  const withTraces = week.projects.filter(({ traces }) => traces > 0);
  return {
    weekLabel: weekLabel(week.isoWeek),
    preferencesUrl,
    organizationName,
    rows,
    folded: selection.folded.flatMap((row) => foldableMailRows({ row, context })),
    steadyEvals: selection.steadyEvals.map(({ evaluatorType, week: counts }) => ({
      evaluator: evaluatorOf(evaluatorType),
      passRatePercent: percentOf({ part: counts.total - counts.failed, whole: counts.total }),
    })),
    ...(withTraces.length > 1
      ? {
          organizationTraces: {
            traces: withTraces.reduce((total, { traces }) => total + traces, 0),
            projects: withTraces.length,
          },
        }
      : {}),
    everythingUrl: baseUrl,
  };
}
