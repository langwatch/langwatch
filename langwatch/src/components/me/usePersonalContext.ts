import { useMemo } from "react";
import { toCategoryBarRows } from "~/components/governance/CategoryBreakdownBars";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { useRequiredSession } from "~/hooks/useRequiredSession";
import { api } from "~/utils/api";

import { useWorkspaceData } from "../useWorkspaceData";

import type { WorkspaceSwitcherProps } from "../WorkspaceSwitcher";

export type PersonalSummary = {
  /** Theoretical (list-price) total, including bundled / non-billed usage. */
  spentThisMonthUsd: number;
  /** Portion actually billed per token; the bundled part is spent - billed. */
  billedThisMonthUsd: number;
  budgetUsd: number | null;
  requestsThisMonth: number;
  requestsDeltaPctVsLastMonth: number | null;
  mostUsedModel: { name: string; usagePct: number } | null;
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
 *
 * The OK status carries the same snapshot fields as warning / exceeded
 * when the user has a real applicable budget — the /me chip needs
 * always-on data ("rogerio-claude-budget · 13% spent" at 13% used)
 * even though no banner fires. Banners still gate on `status`. When
 * the user has no applicable budget at all, the wire collapses to
 * just `{ status: "ok" }` (no extra fields).
 */
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
  switcher: WorkspaceSwitcherProps;
  summary: PersonalSummary;
  budget: PersonalBudgetState;
  spendByDay: Array<{ day: string; usd: number; billedUsd: number }>;
  spendByTool: Array<{ tool: string; usd: number; billedUsd: number }>;
  /** Cost split by content category (ADR-033). Empty when nothing categorized. */
  spendByCategory: Array<{
    category: string;
    label: string;
    costUsd: number;
    tokens: number;
    sharePct: number;
  }>;
  /** True while the usage rollup is still loading — gate the category
   * empty-state on it so the enablement hint doesn't flash during load. */
  spendByCategoryLoading: boolean;
  /** Personal project the /me recent-activity table reads from + deep-links into. */
  personalProjectId: string | null;
  personalProjectSlug: string | null;
  apiKeys: PersonalApiKeyRow[];
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
  // The chip needs always-on snapshot data even when status='ok'
  // (under 80% used) — only collapse to bare {status:'ok'} when there
  // is genuinely no applicable budget (no `limitUsd` on the wire).
  const budget = useMemo<PersonalBudgetState>(() => {
    const raw = personalBudgetQuery.data;
    if (!raw) return { status: "ok" };
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
      requestIncreaseUrl:
        "requestIncreaseUrl" in raw ? (raw.requestIncreaseUrl ?? null) : null,
      adminEmail: "adminEmail" in raw ? (raw.adminEmail ?? null) : null,
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
      // `fmtRelative` reads back this field via `Date.now() -
      // new Date(iso).getTime()` and renders "N min/h/d ago". Sending
      // a date-only `YYYY-MM-DD` made the JS Date parse as midnight
      // UTC, so a key minted 3min ago rendered as "Created 18h ago"
      // (Ariana QA option-C dogfood — visible regression on a
      // freshly-minted key).
      createdAt: row.createdAt.toISOString(),
    }));
  }, [personalKeysQuery.data]);

  const switcherData = useWorkspaceData();
  const switcher = useMemo<WorkspaceSwitcherProps>(
    () => ({ ...switcherData, current: { kind: "personal", orgId } }),
    [switcherData, orgId],
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
      billedThisMonthUsd: personalUsageQuery.data?.summary.billedUsd ?? 0,
      // Always-on chip data: `limitUsd` flows through whenever the user
      // has any applicable budget, regardless of `status`. Banner-only
      // surfaces (BudgetExceededBanner) still gate on `budget.status`.
      budgetUsd: "limitUsd" in budget ? budget.limitUsd : null,
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
    spendByCategory: toCategoryBarRows(
      personalUsageQuery.data?.breakdownByCategory ?? [],
    ),
    spendByCategoryLoading: personalUsageQuery.isLoading,
    personalProjectId: personalContextQuery.data?.workspace.project.id ?? null,
    personalProjectSlug:
      personalContextQuery.data?.workspace.project.slug ?? null,
    apiKeys,
  };
}
