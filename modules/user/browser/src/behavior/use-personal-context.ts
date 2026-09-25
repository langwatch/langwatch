import type { UserPersonalBudget } from "@langwatch/user-contract";
import { useMemo } from "react";

import { readableDate } from "../model/display-formatters.ts";
import type { BudgetOverviewItemView } from "../ui/sections/budget-overview/index.ts";
import { api } from "./personal-workspace-api.ts";
import { useCurrentUser, useOrganizationTeamProject } from "./personal-workspace-session.ts";

export type PersonalSummary = {
  /** Theoretical (list-price) total, including bundled / non-billed usage. */
  spentThisMonthUsd: number;
  /** Portion actually billed per token; the bundled part is spent - billed. */
  billedThisMonthUsd: number;
  requestsThisMonth: number;
  requestsDeltaPctVsLastMonth: number | null;
  mostUsedModel: { name: string; usagePct: number } | null;
};

/**
 * Mirror of `api.user.budgetOverview`: every budget binding the user's own
 * keys, most binding first. `gatewayAccess: false` means the org gives no
 * member-facing gateway path, so budget UI renders nothing, not an empty state.
 */
export type PersonalBudgetOverview = {
  gatewayAccess: boolean;
  budgets: BudgetOverviewItemView[];
  /**
   * True once the server has answered at least once. Empty `budgets` means
   * "no budget binds you" only while this holds — before it, nothing has
   * come back yet. A failed refetch leaves the last answer standing.
   */
  isResolved: boolean;
};

export type PersonalApiKeyRow = {
  id: string;
  label: string;
  deviceHint: string;
  os: "macOS" | "Linux" | "Windows" | "Unknown";
  lastUsedAt: string | null;
  createdAt: string;
};

/** Wire shape for budget state: ok/warning/exceeded with optional details. */
export type PersonalBudgetState =
  | { status: "ok" }
  | {
      status: "ok" | "warning" | "exceeded";
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
  summary: PersonalSummary;
  budget: PersonalBudgetState;
  budgetOverview: PersonalBudgetOverview;
  spendByDay: { day: string; usd: number; billedUsd: number }[];
  spendByTool: { tool: string; usd: number; billedUsd: number }[];
  /** Personal project the /me recent-activity table reads from + deep-links into. */
  personalProjectId: string | null;
  personalProjectSlug: string | null;
  /** Whether the personal project read has answered. */
  isPersonalProjectResolved: boolean;
  apiKeys: PersonalApiKeyRow[];
};

function budgetStateFrom(raw: UserPersonalBudget): PersonalBudgetState {
  if (!("limitUsd" in raw)) return { status: "ok" };
  return {
    status: raw.status,
    spentUsd: Number(raw.spentUsd),
    limitUsd: Number(raw.limitUsd),
    // Server returns lowercase window slug (e.g. "monthly" from
    // `topScope.window.toLowerCase()`); coerce missing to empty so
    // the strict consumer type holds. Same for `scope`.
    period: raw.period ?? "",
    scope: raw.scope ?? "",
    requestIncreaseUrl: "requestIncreaseUrl" in raw ? (raw.requestIncreaseUrl ?? null) : null,
    adminEmail: "adminEmail" in raw ? (raw.adminEmail ?? null) : null,
  };
}

/** Personal-context data source: workspace identity + routing policy + API keys. */
export function usePersonalContext(): PersonalContext {
  const currentUser = useCurrentUser();
  const { organization } = useOrganizationTeamProject();

  const userId = currentUser?.id;
  const userEmail = currentUser?.email ?? "you@example.com";
  const userName = currentUser?.name ?? "You";
  const orgName = organization?.name ?? "Your organization";
  const orgId = organization?.id ?? "org_unknown";

  const personalContextQuery = api.user.personalContext.useQuery(
    { organizationId: orgId },
    { enabled: !!organization, refetchOnWindowFocus: false },
  );

  // Always pin userId to prevent org-wide key sweep.
  const personalKeysQuery = api.personalVirtualKeys.list.useQuery(
    { organizationId: orgId, targetUserId: userId ?? "" },
    {
      enabled: !!organization && !!userId,
      refetchOnWindowFocus: false,
    },
  );

  const personalUsageQuery = api.user.personalUsage.useQuery(
    { organizationId: orgId },
    { enabled: !!organization, refetchOnWindowFocus: false },
  );

  const personalBudgetQuery = api.user.personalBudget.useQuery(
    { organizationId: orgId },
    { enabled: !!organization, refetchOnWindowFocus: false },
  );

  const budgetOverviewQuery = api.user.budgetOverview.useQuery(
    { organizationId: orgId, includeTopModels: true },
    { enabled: !!organization, refetchOnWindowFocus: false },
  );

  // tRPC serializes Prisma Decimal fields as strings — coerce at the hook
  // boundary so downstream UI can use number arithmetic. Collapse to bare
  // {status:'ok'} only when there is genuinely no applicable budget
  // (no `limitUsd` on the wire); the chip needs snapshot data even at status='ok'.
  const budget = useMemo<PersonalBudgetState>(() => {
    const raw = personalBudgetQuery.data;
    if (!raw) return { status: "ok" };
    return budgetStateFrom(raw);
  }, [personalBudgetQuery.data]);

  const apiKeys = useMemo<PersonalApiKeyRow[]>(() => {
    const rows = personalKeysQuery.data;
    if (!rows) return [];
    return rows.map((row) => ({
      id: row.id,
      label: row.name,
      deviceHint: row.description ?? "Personal device",
      os: "Unknown",
      lastUsedAt: row.lastUsedAtMs === null ? null : readableDate(row.lastUsedAtMs).toISOString(),
      // `fmtRelative` computes `Date.now() - new Date(iso).getTime()` to
      // render "N min/h/d ago" — a date-only `YYYY-MM-DD` parses as
      // midnight UTC, so a key minted minutes ago would read hours old.
      createdAt: readableDate(row.createdAtMs).toISOString(),
    }));
  }, [personalKeysQuery.data]);

  // Before the first answer, gatewayAccess true + empty budgets keeps
  // every budget surface blank rather than flashing a "no access" state.
  // `isResolved` is what separates that from a member who genuinely has
  // no budget, so the empty-state copy cannot claim "no budgets apply"
  // about a request that never came back.
  const budgetOverview = useMemo<PersonalBudgetOverview>(() => {
    const raw = budgetOverviewQuery.data;
    if (!raw) return { gatewayAccess: true, budgets: [], isResolved: false };
    return {
      gatewayAccess: raw.gatewayAccess,
      budgets: raw.gatewayAccess ? raw.budgets : [],
      isResolved: true,
    };
  }, [budgetOverviewQuery.data]);

  return {
    ready: !!currentUser && !!organization,
    email: userEmail,
    fullName: userName,
    joinedOn: personalContextQuery.data
      ? readableDate(personalContextQuery.data.workspace.team.createdAtMs)
          .toISOString()
          .slice(0, 10)
      : "—",
    organizationName: orgName,
    organizationId: orgId,
    routingPolicyName: personalContextQuery.data?.routingPolicy?.name ?? null,
    summary: {
      spentThisMonthUsd: personalUsageQuery.data?.summary.spentUsd ?? 0,
      billedThisMonthUsd: personalUsageQuery.data?.summary.billedUsd ?? 0,
      requestsThisMonth: personalUsageQuery.data?.summary.requests ?? 0,
      // Month-over-month delta requires a second window query; defer.
      requestsDeltaPctVsLastMonth: null,
      mostUsedModel: personalUsageQuery.data?.summary.mostUsedModel ?? null,
    },
    budget,
    budgetOverview,
    spendByDay:
      personalUsageQuery.data?.dailyBuckets.map((bucket) => ({
        day: bucket.day,
        usd: bucket.spentUsd,
        billedUsd: bucket.billedUsd,
      })) ?? [],
    // The CH service breaks down by model name today (see gateway.md spec —
    // tool-level breakdown needs User-Agent / `langwatch.client.name`
    // extraction in the trace fold which lands separately). Surface the
    // model-level breakdown in the same UI slot until then.
    spendByTool:
      personalUsageQuery.data?.breakdownByModel.map((row) => ({
        tool: row.label,
        usd: row.spentUsd,
        billedUsd: row.billedUsd,
      })) ?? [],
    isPersonalProjectResolved: personalContextQuery.isSuccess,
    personalProjectId: personalContextQuery.data?.workspace.project.id ?? null,
    personalProjectSlug: personalContextQuery.data?.workspace.project.slug ?? null,
    apiKeys,
  };
}
