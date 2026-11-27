// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/** What one person's weekly email says: the template input, and the picked template's props. */
import type { UsageStats } from "@langwatch/entitlement-contract";
import type {
  DigestCodingAgentWeekProps,
  DigestPlanPressureProps,
  DigestScenariosTrendProps,
  DigestTracesWeekProps,
} from "@langwatch/mail";

import type { DigestTemplateInput, DigestTemplatePick } from "./digest-template.rules.ts";
import {
  BASELINE_WEEKS,
  nextMonthLabel,
  type OutcomeCounts,
  type ProjectWeek,
  type ProjectWeekState,
  userWeekTotals,
  type UserWeekState,
  weekLabel,
  weeksBefore,
} from "./digest-week.rules.ts";

/**
 * A template that has something to send and its props, typed by `@langwatch/mail`'s own props
 * type. "What's new" is absent: it never sends until its card is published.
 */
export type DigestTemplateProps =
  | Readonly<{ templateId: "digest-plan-pressure"; props: DigestPlanPressureProps }>
  | Readonly<{ templateId: "digest-scenarios-trend"; props: DigestScenariosTrendProps }>
  | Readonly<{ templateId: "digest-coding-agent-week"; props: DigestCodingAgentWeekProps }>
  | Readonly<{ templateId: "digest-traces-week"; props: DigestTracesWeekProps }>;

/** The names an email shows, read from their owners when it is rendered and never stored. */
export type DigestNames = Readonly<{
  organizationName: string | null;
  /** The focus project's name and the slug its links are built on, when it has one. */
  project: Readonly<{ name: string; slug: string }> | null;
}>;

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
  /**
   * Each project's traces the week before; a project absent from it has none to compare, either
   * because the read failed or because there were none.
   */
  previousTraces: ReadonlyMap<string, number>;
  users: ReadonlyMap<string, UserWeekState>;
}>;

/** What every template's props open with. */
type CommonProps = Readonly<{ weekLabel: string; preferencesUrl: string }>;

const TOP_ROWS = 3;

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

/** The project the email is about: the busiest by traces, then by scenario runs. */
export function pickFocusProject(week: OrganizationWeek): ProjectWeek | undefined {
  return week.projects.toSorted(
    (left, right) => right.traces - left.traces || right.scenarios.runs - left.scenarios.runs,
  )[0];
}

function baselineOf({
  week,
  projectId,
}: {
  week: OrganizationWeek;
  projectId: string;
}): OutcomeCounts[] {
  return weeksBefore({ isoWeek: week.isoWeek, count: BASELINE_WEEKS }).map(
    (isoWeek) =>
      week.history.find((fold) => fold.projectId === projectId && fold.isoWeek === isoWeek)
        ?.scenarios ?? { runs: 0, passed: 0, failed: 0 },
  );
}

/** What the template rules read for one member of the organization. */
export function digestTemplateInput({
  week,
  userId,
  admin,
}: {
  week: OrganizationWeek;
  userId: string;
  admin: boolean;
}): DigestTemplateInput {
  const user = week.users.get(userId);
  const focus = pickFocusProject(week);
  const usage = week.planUsage;
  return {
    member: {
      isOrganizationAdmin: admin,
      codingAgentSessions: user ? userWeekTotals(user).sessions : 0,
    },
    organization: {
      monthlyLimitUsedPercent: usage ? percentOf({ part: usage.used, whole: usage.limit }) : null,
    },
    project: focus
      ? {
          traces: focus.traces,
          scenarioRuns: focus.scenarios.runs,
          scenarioFailures: focus.scenarios.failed,
          baselineWeeks: baselineOf({ week, projectId: focus.projectId }).map(
            ({ runs, failed }) => ({ runs, failures: failed }),
          ),
        }
      : null,
  };
}

/**
 * The picked template with its props (`@langwatch/mail` digest-*.tsx), links built on the
 * deployment's origin; none when the template has nothing to show, so nothing is sent. "What's
 * new" has no published card yet (the update editor is not built), so it never sends.
 */
export function buildDigestTemplateProps({
  pick,
  week,
  userId,
  names,
  baseUrl,
  preferencesUrl,
  now,
}: {
  pick: DigestTemplatePick;
  week: OrganizationWeek;
  userId: string;
  names: DigestNames;
  baseUrl: string;
  /** The page behind the email's own unsubscribe link. */
  preferencesUrl: string;
  now: number;
}): DigestTemplateProps | undefined {
  const common = { weekLabel: weekLabel(week.isoWeek), preferencesUrl };
  switch (pick.template) {
    case "digest-plan-pressure": {
      const props = buildPlanPressureProps({ week, names, baseUrl, now, common });
      return props && { templateId: pick.template, props };
    }
    case "digest-scenarios-trend": {
      const props = buildScenariosTrendProps({
        week,
        names,
        baseUrl,
        direction: pick.direction,
        common,
      });
      return props && { templateId: pick.template, props };
    }
    case "digest-coding-agent-week": {
      const props = buildCodingAgentWeekProps({ user: week.users.get(userId), baseUrl, common });
      return props && { templateId: pick.template, props };
    }
    case "digest-traces-week": {
      const props = buildTracesWeekProps({ week, names, baseUrl, common });
      return props && { templateId: pick.template, props };
    }
    case "digest-whats-new":
      return undefined;
  }
}

function buildPlanPressureProps({
  week,
  names,
  baseUrl,
  now,
  common,
}: {
  week: OrganizationWeek;
  names: DigestNames;
  baseUrl: string;
  now: number;
  common: CommonProps;
}): DigestPlanPressureProps | undefined {
  const usage = week.planUsage;
  if (!usage || !names.organizationName) return undefined;
  return {
    ...common,
    organizationName: names.organizationName,
    usagePercentage: percentOf({ part: usage.used, whole: usage.limit }),
    used: usage.used,
    limit: usage.limit,
    unit: "traces",
    resetsOn: nextMonthLabel(now),
    samplingUrl: `${baseUrl}/settings/usage`,
    redactionUrl: `${baseUrl}/settings`,
    upgradeUrl: `${baseUrl}/settings/subscription`,
  };
}

function buildScenariosTrendProps({
  week,
  names,
  baseUrl,
  direction,
  common,
}: {
  week: OrganizationWeek;
  names: DigestNames;
  baseUrl: string;
  direction: Extract<DigestTemplatePick, { template: "digest-scenarios-trend" }>["direction"];
  common: CommonProps;
}): DigestScenariosTrendProps | undefined {
  const focus = pickFocusProject(week);
  const project = names.project;
  if (!focus || !project || focus.scenarios.runs === 0) return undefined;
  const baseline = baselineOf({ week, projectId: focus.projectId });
  return {
    ...common,
    projectName: project.name,
    direction: direction === "more_failing" ? "worse" : "better",
    failureRatePercent: percentOf({
      part: focus.scenarios.failed,
      whole: focus.scenarios.runs,
    }),
    baselinePercent: percentOf({
      part: baseline.reduce((sum, counts) => sum + counts.failed, 0),
      whole: baseline.reduce((sum, counts) => sum + counts.runs, 0),
    }),
    runs: focus.scenarios.runs,
    failed: focus.scenarios.failed,
    scenariosUrl: `${baseUrl}/${project.slug}/simulations/scenarios`,
  };
}

function buildCodingAgentWeekProps({
  user,
  baseUrl,
  common,
}: {
  user: UserWeekState | undefined;
  baseUrl: string;
  common: CommonProps;
}): DigestCodingAgentWeekProps | undefined {
  if (!user) return undefined;
  const totals = userWeekTotals(user);
  if (totals.sessions === 0) return undefined;
  const topRepo = Object.entries(user.repositories).toSorted(
    ([, left], [, right]) => right - left,
  )[0]?.[0];
  return {
    ...common,
    sessions: totals.sessions,
    tokens: totals.tokens,
    costUsd: totals.costUsd,
    activeMinutes: Math.round(totals.activeSeconds / 60),
    ...(totals.linesChanged > 0 ? { linesChanged: totals.linesChanged } : {}),
    ...(totals.commits > 0 ? { commits: totals.commits } : {}),
    ...(totals.pullRequests > 0 ? { pullRequests: totals.pullRequests } : {}),
    ...(totals.atLeast ? { totalsAtLeast: true } : {}),
    ...(topRepo ? { topRepo } : {}),
    weekUrl: baseUrl,
  };
}

function buildTracesWeekProps({
  week,
  names,
  baseUrl,
  common,
}: {
  week: OrganizationWeek;
  names: DigestNames;
  baseUrl: string;
  common: CommonProps;
}): DigestTracesWeekProps | undefined {
  const focus = pickFocusProject(week);
  const project = names.project;
  if (!focus || !project || focus.traces === 0) return undefined;
  return {
    ...common,
    projectName: project.name,
    ...tracesWeekNumbers({ week, focus }),
    tracesUrl: `${baseUrl}/${project.slug}/traces`,
  };
}

function tracesWeekNumbers({
  week,
  focus,
}: {
  week: OrganizationWeek;
  focus: ProjectWeek;
}): Omit<DigestTracesWeekProps, keyof CommonProps | "whatsNew" | "projectName" | "tracesUrl"> {
  const previous = week.previousTraces.get(focus.projectId);
  return {
    traces: focus.traces,
    ...(previous !== undefined && previous > 0
      ? {
          changePercent: percentOf({
            part: focus.traces - previous,
            whole: previous,
          }),
        }
      : {}),
    errors: focus.errors,
    costUsd: focus.costUsd,
    tokens: Math.round(focus.tokens),
    p50Milliseconds: Math.round(focus.p50Ms),
    p95Milliseconds: Math.round(focus.p95Ms),
    topModels: Object.entries(focus.models)
      .toSorted(([, left], [, right]) => right - left)
      .slice(0, TOP_ROWS)
      .map(([name, calls]) => ({ name, calls })),
    evaluations: Object.entries(focus.evaluators)
      .filter(([, counts]) => counts.passed + counts.failed > 0)
      .toSorted(([, left], [, right]) => right.runs - left.runs)
      .slice(0, TOP_ROWS)
      .map(([name, counts]) => ({
        name,
        passRatePercent: percentOf({ part: counts.passed, whole: counts.passed + counts.failed }),
      })),
  };
}
