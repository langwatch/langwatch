import { useMemo } from "react";

import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { useRequiredSession } from "~/hooks/useRequiredSession";
import { api } from "~/utils/api";

import type {
  WorkspaceSwitcherProps,
  WorkspaceSwitcherCurrent,
} from "./WorkspaceSwitcher";

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
  const { organization, organizations } = useOrganizationTeamProject({
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

  const switcher = useMemo<WorkspaceSwitcherProps>(() => {
    const personal = {
      kind: "personal" as const,
      href: "/me",
      label: "My Workspace",
      subtitle: "Personal usage, personal budget",
    };

    const teams = (organizations ?? [])
      .flatMap((org) =>
        (org.teams ?? []).map((team) => ({
          kind: "team" as const,
          teamId: team.id,
          teamSlug: team.slug,
          href: `/settings/teams/${team.slug}`,
          label: team.name,
          subtitle: "Team I'm part of",
        })),
      )
      .sort((a, b) => a.label.localeCompare(b.label));

    const projects = (organizations ?? [])
      .flatMap((org) =>
        (org.teams ?? []).flatMap((team) =>
          (team.projects ?? []).map((project) => ({
            kind: "project" as const,
            projectId: project.id,
            projectSlug: project.slug,
            href: `/${project.slug}`,
            label: project.name,
            subtitle: "Project I work on",
          })),
        ),
      )
      .sort((a, b) => a.label.localeCompare(b.label));

    const current: WorkspaceSwitcherCurrent = { kind: "personal" };

    return { personal, teams, projects, current };
  }, [organizations]);

  return {
    ready: !!session && !!organization,
    email: userEmail,
    fullName: userName,
    joinedOn: "—",
    organizationName: orgName,
    organizationId: orgId,
    routingPolicyName: personalContextQuery.data?.routingPolicy?.name ?? null,
    switcher,
    summary: {
      // ClickHouse per-user aggregations not shipped yet — using mocked
      // shape so the dashboard renders meaningfully. Real data flows in
      // once the per-user trace-fold projection lands.
      spentThisMonthUsd: 0,
      budgetUsd: null,
      requestsThisMonth: 0,
      requestsDeltaPctVsLastMonth: null,
      mostUsedModel: null,
    },
    spendByDay: [],
    spendByTool: [],
    recentActivity: [],
    apiKeys,
    notificationPrefs: {
      budgetThreshold80: true,
      weeklySummary: true,
      perRequestOverOneDollar: false,
    },
  };
}
