// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
// @vitest-environment jsdom
/**
 * The kill switch on the Agents page: a stop's status on its row, the approvals card, and the
 * Stop dialog that names the plan's targets and asks why. Only the tRPC client is doubled.
 *
 * Spec: enterprise/modules/governance/specs/agent-kill-switch.feature
 */
import { builtinRolePermissions } from "@langwatch/authz-contract";
import type {
  AgentKillSwitchSummary,
  AgentStopView,
  GovernanceAgentRow,
} from "@langwatch/enterprise-governance-contract";
import "@testing-library/jest-dom/vitest";
import { cleanup, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { fakeGovernanceHost, renderWithGovernanceHost } from "../../../testing.tsx";

const harness = vi.hoisted(() => ({
  reads: {} as Record<string, unknown>,
  calls: [] as { procedure: string; input: unknown }[],
  invalidated: [] as string[],
}));

vi.mock("@langwatch/browser-host/drawer", async () => ({
  ...(await vi.importActual("@langwatch/browser-host/drawer")),
  useDrawer: () => ({ openDrawer: vi.fn(), closeDrawer: vi.fn(), goBack: vi.fn() }),
}));

vi.mock("../../../behavior/governance-api.ts", () => {
  const utils = (path: string[]): unknown =>
    new Proxy(
      {},
      {
        get(_target, property) {
          if (typeof property !== "string") return undefined;
          if (property === "invalidate") {
            return async () => {
              harness.invalidated.push(path.join("."));
            };
          }
          return utils([...path, property]);
        },
      },
    );
  const node = (path: string[]): unknown =>
    new Proxy(
      {},
      {
        get(_target, property) {
          if (typeof property !== "string") return undefined;
          const full = path.join(".");
          if (property === "useUtils") return () => utils([]);
          if (property === "useQuery") {
            return () => ({
              data: harness.reads[full],
              isPending: false,
              isLoading: false,
              error: null,
              refetch: vi.fn(),
            });
          }
          if (property === "useMutation") {
            return () => ({
              mutate: (input: unknown) => harness.calls.push({ procedure: full, input }),
              mutateAsync: async (input: unknown) => {
                harness.calls.push({ procedure: full, input });
                return {};
              },
              isPending: false,
              variables: undefined,
              error: null,
            });
          }
          return node([...path, property]);
        },
      },
    );
  const api = node([]);
  return { api, governanceApi: api };
});

import AgentsPage from "../../../ui/sections/governance/agents.tsx";

const MANAGER = [...builtinRolePermissions("org-admin"), ...builtinRolePermissions("admin")];
const VIEWER = ["governance:view"];

const agentRow = (id: string, name: string): GovernanceAgentRow => ({
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
});

const stopOf = ({
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

const summary = (overrides: Partial<AgentKillSwitchSummary> & { agentId: string }) => ({
  inventoryRowId: `registered:${overrides.agentId}`,
  planTargetCount: 2,
  openStop: null,
  ...overrides,
});

function renderPage({ permissions }: { permissions: readonly string[] }) {
  const host = fakeGovernanceHost({ permissions });
  return renderWithGovernanceHost(
    <MemoryRouter initialEntries={["/governance/agents"]}>
      <AgentsPage />
    </MemoryRouter>,
    { host },
  );
}

const rowOf = (name: string) => {
  const row = screen
    .getAllByTestId("governance-agent-row")
    .find((candidate) => candidate.getAttribute("data-agent") === name);
  if (!row) throw new Error(`no row for ${name}`);
  return row;
};

const openActions = async (name: string) => {
  await userEvent.click(within(rowOf(name)).getByRole("button", { name: `Actions for ${name}` }));
};

beforeEach(() => {
  window.sessionStorage.clear();
  harness.calls = [];
  harness.invalidated = [];
  harness.reads = {
    "governanceAgents.list": [agentRow("a1", "support-bot"), agentRow("a2", "pricing-bot")],
    "governanceAgents.syncSources": [],
    "governanceKillSwitch.plan": {
      agentId: "a1",
      updatedAt: "2026-11-15T10:00:00.000Z",
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
    },
  };
});

afterEach(() => cleanup());

describe("the Agents page with stops of its agents", () => {
  beforeEach(() => {
    harness.reads["governanceKillSwitch.summaries"] = [
      summary({
        agentId: "a1",
        openStop: stopOf({
          id: "stop-1",
          agentId: "a1",
          agentName: "support-bot",
          status: "quarantined",
        }),
      }),
      summary({
        agentId: "a2",
        openStop: stopOf({
          id: "stop-2",
          agentId: "a2",
          agentName: "pricing-bot",
          status: "pending_approval",
        }),
      }),
    ];
    harness.reads["governanceKillSwitch.pendingApprovals"] = [
      stopOf({ id: "stop-2", agentId: "a2", agentName: "pricing-bot", status: "pending_approval" }),
    ];
  });

  describe("when a person with governance:view opens it", () => {
    /** @scenario "The agents inventory shows a quarantined agent's status and pending approvals" */
    it("shows support-bot as Quarantined with a Restore action", async () => {
      renderPage({ permissions: VIEWER });

      expect(within(rowOf("support-bot")).getByTestId("agent-stop-status")).toHaveTextContent(
        "Quarantined",
      );
      await openActions("support-bot");
      expect(await screen.findByRole("menuitem", { name: /Restore/ })).toBeInTheDocument();
    });

    /** @scenario "The agents inventory shows a quarantined agent's status and pending approvals" */
    it("lists pricing-bot's pending stop without Approve or Deny", () => {
      renderPage({ permissions: VIEWER });

      const card = screen.getByTestId("stop-approvals-card");
      expect(within(card).getByText("pricing-bot")).toBeInTheDocument();
      expect(within(card).queryByRole("button", { name: "Approve" })).toBeNull();
      expect(within(card).queryByRole("button", { name: "Deny" })).toBeNull();
    });
  });

  describe("when a person with governance:manage opens it", () => {
    /** @scenario "The agents inventory shows a quarantined agent's status and pending approvals" */
    it("offers Approve and Deny on pricing-bot's approval card", async () => {
      renderPage({ permissions: MANAGER });

      const row = within(screen.getByTestId("stop-approvals-card")).getByTestId(
        "stop-approval-row",
      );
      expect(row).toHaveAttribute("data-agent", "pricing-bot");
      await userEvent.click(within(row).getByRole("button", { name: "Approve" }));

      expect(harness.calls).toContainEqual({
        procedure: "governanceKillSwitch.approveStop",
        input: { organizationId: "org-1", stopId: "stop-2" },
      });
      expect(harness.invalidated).toContain("governanceKillSwitch.pendingApprovals");
      expect(within(row).getByRole("button", { name: "Deny" })).toBeInTheDocument();
    });

    /** @scenario "The agents inventory shows a quarantined agent's status and pending approvals" */
    it("restores the quarantined agent after a confirm", async () => {
      renderPage({ permissions: MANAGER });

      await openActions("support-bot");
      await userEvent.click(await screen.findByRole("menuitem", { name: /Restore/ }));
      const dialog = await screen.findByRole("dialog", { name: "Restore support-bot?" });
      await userEvent.click(within(dialog).getByRole("button", { name: "Restore agent" }));

      expect(harness.calls).toContainEqual({
        procedure: "governanceKillSwitch.restore",
        input: { organizationId: "org-1", stopId: "stop-1" },
      });
    });
  });
});

describe("the Stop button of an agent with a stop plan", () => {
  beforeEach(() => {
    harness.reads["governanceKillSwitch.summaries"] = [summary({ agentId: "a1" })];
    harness.reads["governanceKillSwitch.pendingApprovals"] = [];
  });

  const openStopDialog = async () => {
    renderPage({ permissions: MANAGER });
    await openActions("support-bot");
    await userEvent.click(await screen.findByRole("menuitem", { name: /Stop$/ }));
    return screen.findByRole("alertdialog", { name: "Stop support-bot?" });
  };

  /** @scenario "The Stop button asks for confirmation before stopping" */
  it("names the plan's targets and asks for a reason", async () => {
    const dialog = await openStopDialog();

    const targets = within(dialog).getByTestId("stop-agent-targets");
    expect(targets).toHaveTextContent("support-bot-prod (Databricks serving endpoint)");
    expect(targets).toHaveTextContent("Support key (Gateway virtual key)");
    expect(within(dialog).getByRole("textbox", { name: "Reason" })).toBeInTheDocument();
    expect(harness.calls).toEqual([]);
  });

  /** @scenario "The Stop button asks for confirmation before stopping" */
  it("requests the stop with the reason on confirm", async () => {
    const dialog = await openStopDialog();

    await userEvent.type(within(dialog).getByRole("textbox", { name: "Reason" }), "Leaking data");
    await userEvent.click(within(dialog).getByRole("button", { name: "Stop agent" }));

    expect(harness.calls).toEqual([
      {
        procedure: "governanceKillSwitch.requestStop",
        input: { organizationId: "org-1", agentId: "a1", reason: "Leaking data" },
      },
    ]);
    expect(harness.invalidated).toContain("governanceKillSwitch.summaries");
  });

  it("refuses to stop without a reason and says why", async () => {
    const dialog = await openStopDialog();

    await userEvent.click(within(dialog).getByRole("button", { name: "Stop agent" }));

    expect(harness.calls).toEqual([]);
    expect(within(dialog).getByText("Say why you are stopping this agent.")).toBeInTheDocument();
  });

  it("keeps Stop shut for an agent with no stop plan, saying why", async () => {
    harness.reads["governanceKillSwitch.summaries"] = [
      summary({ agentId: "a1", planTargetCount: 0 }),
    ];
    renderPage({ permissions: MANAGER });
    await openActions("support-bot");

    const stop = await screen.findByRole("menuitem", { name: /Add a stop plan first/ });
    expect(stop).toHaveAttribute("data-disabled");
    expect(stop).toHaveTextContent("Add a stop plan first");
  });
});

describe("the stop plan of an agent", () => {
  beforeEach(() => {
    harness.reads["governanceKillSwitch.summaries"] = [summary({ agentId: "a1" })];
    harness.reads["governanceKillSwitch.pendingApprovals"] = [];
    harness.reads["governanceKillSwitch.awsConnections"] = [];
  });

  const openPlan = async () => {
    renderPage({ permissions: MANAGER });
    await openActions("support-bot");
    await userEvent.click(await screen.findByRole("menuitem", { name: /Stop plan/ }));
    return screen.findByRole("dialog", { name: "Stop plan for support-bot" });
  };

  it("saves the plan without a removed target", async () => {
    const dialog = await openPlan();

    await userEvent.click(within(dialog).getByRole("button", { name: "Remove Support key" }));
    await userEvent.click(within(dialog).getByRole("button", { name: "Save plan" }));

    expect(harness.calls).toEqual([
      {
        procedure: "governanceKillSwitch.setPlan",
        input: {
          organizationId: "org-1",
          agentId: "a1",
          targets: [
            {
              kind: "databricks_serving_endpoint",
              ingestionSourceId: "src-1",
              endpointName: "support-bot-prod",
            },
          ],
        },
      },
    ]);
    expect(harness.invalidated).toContain("governanceKillSwitch.plan");
  });

  /** @scenario "The stop plan dialog offers the organisation's Databricks Genie sources" */
  it("offers a Databricks Genie source in the serving endpoint target's picker", async () => {
    harness.reads["governanceAgents.syncSources"] = [
      {
        id: "src-genie",
        name: "Databricks prod",
        sourceType: "databricks_genie",
        lastListing: null,
      },
    ];
    const dialog = await openPlan();

    await userEvent.click(within(dialog).getByRole("combobox", { name: "Databricks source" }));

    expect(await screen.findByRole("option", { name: "Databricks prod" })).toBeInTheDocument();
  });

  it("refuses a target with an empty field and says why", async () => {
    const dialog = await openPlan();

    await userEvent.click(within(dialog).getByRole("button", { name: "Add target" }));

    expect(within(dialog).getByRole("alert")).toHaveTextContent(
      "Fill in every field of the target.",
    );
    expect(within(dialog).getAllByTestId("stop-plan-target")).toHaveLength(2);
  });
});
