import { useMemo } from "react";

import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { useRequiredSession } from "~/hooks/useRequiredSession";
import { api } from "~/utils/api";

import { useWorkspaceData } from "../useWorkspaceData";

import type { WorkspaceSwitcherProps } from "../WorkspaceSwitcher";

export type PersonalSummary = {
  spentThisMonthUsd: number;
  budgetUsd: number | null;
  requestsThisMonth: number;
  requestsDeltaPctVsLastMonth: number | null;
  mostUsedModel: { name: string; usagePct: number } | null;
};

export type PersonalRecentActivityRow = {
  id: string;
  occurredAt: string;
  toolName: string;
  summary: string;
  costUsd: number;
};

export type PersonalApiKeyRow = {
  id: string;
  label: string;
  deviceHint: string;
  os: "macOS" | "Linux" | "Windows" | "Unknown";
  lastUsedAt: string | null;
  createdAt: string;
};

/**
 * Wire shape mirrors `api.user.personalBudget` (Sergey's dc07c772e) and
 * the gateway 402 body. status=ok → no banner; warning → yellow 80%
 * banner; exceeded → BudgetExceededBanner with the structured fields.
 */
export type PersonalBudgetState =
  | { status: "ok" }
  | {
      status: "warning" | "exceeded";
      spentUsd: number;
      limitUsd: number;
      period: string;
      scope: string;
      requestIncreaseUrl?: string | null;
      adminEmail?: string | null;
    };

export type PersonalContext = {
  ready: boolean;
  email: string;
  fullName: string;
  joinedOn: string;
  organizationName: string;
  organizationId: string;
  routingPolicyName: string | null;
  switcher: WorkspaceSwitcherProps;
  summary: PersonalSummary;
  budget: PersonalBudgetState;
  spendByDay: Array<{ day: string; usd: number }>;
  spendByTool: Array<{ tool: string; usd: number }>;
  recentActivity: PersonalRecentActivityRow[];
  apiKeys: PersonalApiKeyRow[];
  notificationPrefs: {
    budgetThreshold80: boolean;
    weeklySummary: boolean;
    perRequestOverOneDollar: boolean;
  };
};

/**
 * Personal-context data source. Pulls workspace identity + routing policy
 * + API-key list from real tRPC. Cost / spend-over-time / by-tool /
 * recent-activity are still mocked because the per-user ClickHouse
 * aggregations aren't shipped yet — they will plug in here once the
 * trace-fold reactor learns to project per-user totals.
 *
 * Spec: specs/ai-gateway/governance/personal-keys.feature
 *       specs/ai-gateway/governance/my-usage-dashboard.feature
 *       specs/ai-gateway/governance/my-settings.feature
 */
export function usePersonalContext(): PersonalContext {
  const { data: session } = useRequiredSession();
  const { organization } = useOrganizationTeamProject({
    redirectToOnboarding: false,
  });

  const userEmail = session?.user.email ?? "you@example.com";
  const userName = session?.user.name ?? "You";
  const orgName = organization?.name ?? "Your organization";
  const orgId = organization?.id ?? "org_unknown";

  const personalContextQuery = api.user.personalContext.useQuery(
    { organizationId: orgId },
    { enabled: !!organization, refetchOnWindowFocus: false },
  );

  const personalKeysQuery = api.personalVirtualKeys.list.useQuery(
    { organizationId: orgId },
    { enabled: !!organization, refetchOnWindowFocus: false },
  );

  const personalUsageQuery = api.user.personalUsage.useQuery(
    { organizationId: orgId },
    { enabled: !!organization, refetchOnWindowFocus: false },
  );

  const personalBudgetQuery = api.user.personalBudget.useQuery(
    { organizationId: orgId },
    { enabled: !!organization, refetchOnWindowFocus: false },
  );

  // tRPC serializes Prisma Decimal fields as strings — coerce at the
  // hook boundary so downstream UI (BudgetExceededBanner, /me dashboard)
  // can use number arithmetic without re-coercing in every consumer.
  const budget = useMemo<PersonalBudgetState>(() => {
    const raw = personalBudgetQuery.data;
    if (!raw || raw.status === "ok") return { status: "ok" };
    return {
      status: raw.status,
      spentUsd: Number(raw.spentUsd),
      limitUsd: Number(raw.limitUsd),
      period: raw.period,
      scope: raw.scope,
      requestIncreaseUrl: raw.requestIncreaseUrl ?? null,
      adminEmail: raw.adminEmail ?? null,
    };
  }, [personalBudgetQuery.data]);

  const apiKeys = useMemo<PersonalApiKeyRow[]>(() => {
    const rows = personalKeysQuery.data;
    if (!rows) return [];
    return rows.map((row) => ({
      id: row.id,
      label: row.name,
      deviceHint: row.description ?? "Personal device",
      os: "Unknown",
      lastUsedAt: row.lastUsedAt ? row.lastUsedAt.toISOString() : null,
      createdAt: row.createdAt.toISOString().slice(0, 10),
    }));
  }, [personalKeysQuery.data]);

  const switcherData = useWorkspaceData();
  const switcher = useMemo<WorkspaceSwitcherProps>(
    () => ({ ...switcherData, current: { kind: "personal" } }),
    [switcherData],
  );

  return {
    ready: !!session && !!organization,
    email: userEmail,
    fullName: userName,
    joinedOn:
      personalContextQuery.data?.workspace.team.createdAt
        ?.toISOString()
        ?.slice(0, 10) ?? "—",
    organizationName: orgName,
    organizationId: orgId,
    routingPolicyName: personalContextQuery.data?.routingPolicy?.name ?? null,
    switcher,
    summary: {
      spentThisMonthUsd: personalUsageQuery.data?.summary.spentUsd ?? 0,
      budgetUsd: budget.status === "ok" ? null : budget.limitUsd,
      requestsThisMonth: personalUsageQuery.data?.summary.requests ?? 0,
      // Month-over-month delta requires a second window query; defer.
      requestsDeltaPctVsLastMonth: null,
      mostUsedModel: personalUsageQuery.data?.summary.mostUsedModel ?? null,
    },
    budget,
    spendByDay:
      personalUsageQuery.data?.dailyBuckets.map((bucket) => ({
        day: bucket.day,
        usd: bucket.spentUsd,
      })) ?? [],
    // The CH service breaks down by model name today (see gateway.md spec —
    // tool-level breakdown needs User-Agent / `langwatch.client.name`
    // extraction in the trace fold which lands separately). Surface the
    // model-level breakdown in the same UI slot until then.
    spendByTool:
      personalUsageQuery.data?.breakdownByModel.map((row) => ({
        tool: row.label,
        usd: row.spentUsd,
      })) ?? [],
    recentActivity:
      personalUsageQuery.data?.recentActivity.map((row) => ({
        id: row.traceId,
        occurredAt: row.occurredAt,
        toolName: row.models[0] ?? "—",
        summary: row.preview,
        costUsd: row.spentUsd,
      })) ?? [],
    apiKeys,
    notificationPrefs: {
      budgetThreshold80: true,
      weeklySummary: true,
      perRequestOverOneDollar: false,
    },
  };
}
