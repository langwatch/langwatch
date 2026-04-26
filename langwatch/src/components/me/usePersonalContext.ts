import { useMemo } from "react";

import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { useRequiredSession } from "~/hooks/useRequiredSession";

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

const MOCK_DAYS = (() => {
  const days: Array<{ day: string; usd: number }> = [];
  const today = new Date();
  // 14 days of mock data — small numbers so the chart shape is interesting.
  const base = [0.4, 1.2, 2.1, 1.8, 0.6, 0.1, 0.9, 3.2, 4.4, 2.6, 1.1, 1.7, 5.1, 2.8];
  for (let i = 13; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(today.getDate() - i);
    days.push({
      day: d.toISOString().slice(0, 10),
      usd: base[13 - i] ?? 0,
    });
  }
  return days;
})();

const MOCK_TOOL_BREAKDOWN = [
  { tool: "Claude Code", usd: 31.4 },
  { tool: "Cursor", usd: 8.22 },
  { tool: "Codex CLI", usd: 2.56 },
];

const MOCK_RECENT: PersonalRecentActivityRow[] = [
  {
    id: "trace_1",
    occurredAt: "10:42",
    toolName: "claude",
    summary: "refactor auth middleware",
    costUsd: 0.18,
  },
  {
    id: "trace_2",
    occurredAt: "10:31",
    toolName: "claude",
    summary: "add tests for user model",
    costUsd: 0.42,
  },
  {
    id: "trace_3",
    occurredAt: "09:55",
    toolName: "cursor",
    summary: "tab completion (×34)",
    costUsd: 0.06,
  },
  {
    id: "trace_4",
    occurredAt: "09:14",
    toolName: "claude",
    summary: "explain webpack config",
    costUsd: 0.11,
  },
];

const MOCK_API_KEYS: PersonalApiKeyRow[] = [
  {
    id: "vk_jane_laptop",
    label: "jane-laptop",
    deviceHint: "MacBook Pro",
    os: "macOS",
    lastUsedAt: new Date(Date.now() - 2 * 60_000).toISOString(),
    createdAt: "2026-04-24",
  },
  {
    id: "vk_jane_desktop",
    label: "jane-desktop",
    deviceHint: "Linux",
    os: "Linux",
    lastUsedAt: new Date(Date.now() - 4 * 24 * 60 * 60_000).toISOString(),
    createdAt: "2026-04-25",
  },
];

/**
 * Personal-context data source. Initial implementation returns a mocked
 * shape so the UI can be built and dogfooded immediately. When Sergey's
 * `user.personalContext` tRPC query lands (see specs/ai-gateway/governance/
 * personal-keys.feature + my-usage-dashboard.feature), swap the mocked
 * branches for the real `api.user.personalContext.useQuery(...)` call —
 * the public shape above is the contract we're targeting.
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
    ready: !!session,
    email: userEmail,
    fullName: userName,
    joinedOn: "2026-04-24",
    organizationName: orgName,
    organizationId: orgId,
    routingPolicyName: "developer-default",
    switcher,
    summary: {
      spentThisMonthUsd: 42.18,
      budgetUsd: 500,
      requestsThisMonth: 1284,
      requestsDeltaPctVsLastMonth: 18,
      mostUsedModel: { name: "Claude Sonnet", usagePct: 72 },
    },
    spendByDay: MOCK_DAYS,
    spendByTool: MOCK_TOOL_BREAKDOWN,
    recentActivity: MOCK_RECENT,
    apiKeys: MOCK_API_KEYS,
    notificationPrefs: {
      budgetThreshold80: true,
      weeklySummary: true,
      perRequestOverOneDollar: false,
    },
  };
}
