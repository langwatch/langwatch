// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * The kill switch suites' world: contract-shaped agents, stops and plans, the default answers
 * the Agents page needs, and the helpers that open its rows and dialogs.
 */
import { builtinRolePermissions } from "@langwatch/authz-contract";
import type {
  AgentKillSwitchSummary,
  AgentStopPlan,
  AgentStopView,
  GovernanceAgentRow,
} from "@langwatch/enterprise-governance-contract";
import { readHandledError } from "@langwatch/handled-error/read-handled-error";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";

import type { GovernancePlan } from "../../../model/governance-host.ts";
import { fakeGovernanceHost, renderWithGovernanceHost } from "../../../testing.tsx";
import AgentsPage from "../../../ui/sections/governance/agents.tsx";
import { answerQuery } from "./kill-switch-api-double.tsx";

export const MANAGER = [...builtinRolePermissions("org-admin"), ...builtinRolePermissions("admin")];
export const VIEWER = ["governance:view"];

export const agentRow = (id: string, name: string): GovernanceAgentRow => ({
  id: `registered:${id}`,
  name,
  environment: "production",
  owner: "Support",
  models: ["gpt-5-mini"],
  source: "custom",
  costUsd30d: 10,
  requests30d: 100,
  lastActiveMinutesAgo: 5,
  health: "responding",
  registeredDaysAgo: 30,
  posture: "governed",
  platform: null,
});

export const stopOf = ({
  id,
  agentId,
  agentName,
  status,
}: {
  id: string;
  agentId: string;
  agentName: string;
  status: AgentStopView["status"];
}): AgentStopView => ({
  id,
  agentId,
  agentName,
  status,
  severity: "high",
  approval: status === "pending_approval" ? "required" : "immediate",
  trigger: status === "pending_approval" ? "api_key" : "user",
  reason: `${agentName} is misbehaving`,
  requestedBy: { userId: null, apiKeyId: "key-1" },
  decidedByUserId: null,
  restoredByUserId: null,
  targets: [],
  requestedAt: "2026-11-16T09:00:00.000Z",
  decidedAt: null,
  quarantinedAt: null,
  restoreRequestedAt: null,
  restoredAt: null,
});

export const summary = (
  overrides: Partial<AgentKillSwitchSummary> & { agentId: string },
): AgentKillSwitchSummary => ({
  inventoryRowId: `registered:${overrides.agentId}`,
  planTargetCount: 2,
  openStop: null,
  ...overrides,
});

export const SUPPORT_BOT_PLAN: AgentStopPlan = {
  agentId: "a1",
  updatedAt: "2026-11-15T10:00:00.000Z",
  version: 3,
  targets: [
    {
      id: "t1",
      label: "support-bot-prod",
      target: {
        kind: "databricks_serving_endpoint",
        ingestionSourceId: "src-1",
        endpointName: "support-bot-prod",
      },
    },
    {
      id: "t2",
      label: "Support key",
      target: { kind: "gateway_virtual_key", virtualKeyId: "vk-1" },
    },
  ],
};

/** What the Agents page reads with no stop anywhere: two agents, each with a two-target plan. */
export function answerAgentsPage({
  summaries = [summary({ agentId: "a1" }), summary({ agentId: "a2" })],
  pendingApprovals = [],
}: {
  summaries?: AgentKillSwitchSummary[];
  pendingApprovals?: AgentStopView[];
} = {}) {
  answerQuery("governanceAgents.list", () => [
    agentRow("a1", "support-bot"),
    agentRow("a2", "pricing-bot"),
  ]);
  answerQuery("governanceAgents.syncSources", () => []);
  answerQuery("governanceKillSwitch.summaries", () => summaries);
  answerQuery("governanceKillSwitch.pendingApprovals", () => pendingApprovals);
  answerQuery("governanceKillSwitch.plan", () => SUPPORT_BOT_PLAN);
  answerQuery("governanceKillSwitch.awsConnections", () => []);
  answerQuery("governanceRegistry.settings", () => ({ dormant_after_days: 30 }));
}

export function renderAgentsPage({
  permissions,
  plan,
}: {
  permissions: readonly string[];
  plan?: GovernancePlan;
}) {
  const host = fakeGovernanceHost({ permissions, ...(plan ? { plan } : {}) });
  renderWithGovernanceHost(
    <MemoryRouter initialEntries={["/governance/agents"]}>
      <AgentsPage />
    </MemoryRouter>,
    { host },
  );
  return host;
}

export const rowOf = (name: string) => {
  const row = screen
    .getAllByTestId("governance-agent-row")
    .find((candidate) => candidate.getAttribute("data-agent") === name);
  if (!row) throw new Error(`no row for ${name}`);
  return row;
};

export async function openActions(name: string) {
  const row = await screen.findAllByTestId("governance-agent-row").then(() => rowOf(name));
  await userEvent.click(await within(row).findByRole("button", { name: `Actions for ${name}` }));
}

export async function openStopDialog({ permissions = MANAGER }: { permissions?: string[] } = {}) {
  const host = renderAgentsPage({ permissions });
  await openActions("support-bot");
  await userEvent.click(await screen.findByRole("menuitem", { name: /Stop$/ }));
  const dialog = await screen.findByRole("alertdialog", { name: "Stop support-bot?" });
  return { host, dialog };
}

export async function openPlanDialog() {
  const host = renderAgentsPage({ permissions: MANAGER });
  await openActions("support-bot");
  await userEvent.click(await screen.findByRole("menuitem", { name: /Stop plan/ }));
  const dialog = await screen.findByRole("dialog", { name: "Stop plan for support-bot" });
  return { host, dialog };
}

/** The handled error codes the host was asked to show, in order. */
export const failureCodes = (host: ReturnType<typeof renderAgentsPage>) =>
  host.recording.failures.map((failure) => readHandledError(failure.error)?.code ?? null);
