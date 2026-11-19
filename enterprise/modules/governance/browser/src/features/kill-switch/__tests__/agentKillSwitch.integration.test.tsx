// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
// @vitest-environment jsdom
/**
 * The kill switch on the Agents page: a stop's status on its row, the approvals card, failed
 * reads with Retry, and the re-read each write ends with; later changes arrive as read hints.
 * Only the tRPC binding is doubled. Spec: enterprise/modules/governance/specs/agent-kill-switch.feature
 */
import "@testing-library/jest-dom/vitest";
import type { AgentStopView } from "@langwatch/enterprise-governance-contract";
import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  answerMutation,
  answerQuery,
  handledError,
  assertEveryCallConfigured,
  resetTrpcDouble,
  retryingFailure,
  trpcDouble,
} from "./kill-switch-api-double.tsx";
import {
  answerAgentsPage,
  MANAGER,
  openActions,
  openStopDialog,
  renderAgentsPage,
  rowOf,
  stopOf,
  summary,
  VIEWER,
} from "./kill-switch-fixtures.tsx";

vi.mock("@langwatch/browser-host/drawer", async () => ({
  ...(await vi.importActual("@langwatch/browser-host/drawer")),
  useDrawer: () => ({ openDrawer: vi.fn(), closeDrawer: vi.fn(), goBack: vi.fn() }),
}));

vi.mock("../../../behavior/governance-api.ts", async () =>
  (await import("./kill-switch-api-double.tsx")).governanceApiDouble(),
);

const QUARANTINED = stopOf({
  id: "stop-1",
  agentId: "a1",
  agentName: "support-bot",
  status: "quarantined",
});
const PENDING = stopOf({
  id: "stop-2",
  agentId: "a2",
  agentName: "pricing-bot",
  status: "pending_approval",
});

beforeEach(() => {
  window.sessionStorage.clear();
  resetTrpcDouble();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  assertEveryCallConfigured();
});

describe("the Agents page with stops of its agents", () => {
  beforeEach(() => {
    answerAgentsPage({
      summaries: [
        summary({ agentId: "a1", openStop: QUARANTINED }),
        summary({ agentId: "a2", openStop: PENDING }),
      ],
      pendingApprovals: [PENDING],
    });
  });

  describe("when a person with governance:view opens it", () => {
    /** @scenario "The agents inventory shows a quarantined agent's status and pending approvals" */
    it("shows support-bot as Quarantined with a Restore action", async () => {
      renderAgentsPage({ permissions: VIEWER });

      await screen.findAllByTestId("governance-agent-row");
      expect(
        await within(rowOf("support-bot")).findByTestId("agent-stop-status"),
      ).toHaveTextContent("Quarantined");
      await openActions("support-bot");
      expect(await screen.findByRole("menuitem", { name: /Restore/ })).toBeInTheDocument();
    });

    /** @scenario "The agents inventory shows a quarantined agent's status and pending approvals" */
    it("lists pricing-bot's pending stop without Approve or Deny", async () => {
      renderAgentsPage({ permissions: VIEWER });

      const card = await screen.findByTestId("stop-approvals-card");
      expect(within(card).getByText("pricing-bot")).toBeInTheDocument();
      expect(within(card).queryByRole("button", { name: "Approve" })).toBeNull();
      expect(within(card).queryByRole("button", { name: "Deny" })).toBeNull();
    });
  });

  describe("when a person with governance:manage opens it", () => {
    /** @scenario "The agents inventory shows a quarantined agent's status and pending approvals" */
    it("approves pricing-bot's stop from its approval card", async () => {
      answerMutation("governanceKillSwitch.approveStop", () => ({
        ...PENDING,
        status: "stopping",
      }));
      renderAgentsPage({ permissions: MANAGER });

      const row = within(await screen.findByTestId("stop-approvals-card")).getByTestId(
        "stop-approval-row",
      );
      expect(row).toHaveAttribute("data-agent", "pricing-bot");
      await userEvent.click(within(row).getByRole("button", { name: "Approve" }));

      expect(trpcDouble.calls).toContainEqual({
        procedure: "governanceKillSwitch.approveStop",
        input: { organizationId: "org-1", stopId: "stop-2", expectedTargetIds: [] },
      });
      expect(trpcDouble.invalidated).toContain("governanceKillSwitch.pendingApprovals");
    });

    /** @scenario "Denying a pending stop from its approval card keeps the note" */
    it("denies pricing-bot's stop with the trimmed note and closes the dialog", async () => {
      answerMutation("governanceKillSwitch.denyStop", () => ({ ...PENDING, status: "denied" }));
      renderAgentsPage({ permissions: MANAGER });

      const row = within(await screen.findByTestId("stop-approvals-card")).getByTestId(
        "stop-approval-row",
      );
      await userEvent.click(within(row).getByRole("button", { name: "Deny" }));
      const dialog = await screen.findByRole("dialog", { name: "Deny the stop of pricing-bot?" });
      await userEvent.type(within(dialog).getByRole("textbox", { name: "Note" }), " False alarm ");
      await userEvent.click(within(dialog).getByRole("button", { name: "Deny stop" }));

      expect(trpcDouble.calls).toContainEqual({
        procedure: "governanceKillSwitch.denyStop",
        input: { organizationId: "org-1", stopId: "stop-2", note: "False alarm" },
      });
      expect(trpcDouble.invalidated).toContain("governanceKillSwitch.pendingApprovals");
      await waitFor(() =>
        expect(screen.queryByRole("dialog", { name: "Deny the stop of pricing-bot?" })).toBeNull(),
      );
    });

    /** @scenario "Denying a pending stop from its approval card keeps the note" */
    it("keeps the dialog open when the denial is refused", async () => {
      answerMutation("governanceKillSwitch.denyStop", () => {
        throw handledError({ code: "agent_stop_not_pending", httpStatus: 409 });
      });
      renderAgentsPage({ permissions: MANAGER });

      const row = within(await screen.findByTestId("stop-approvals-card")).getByTestId(
        "stop-approval-row",
      );
      await userEvent.click(within(row).getByRole("button", { name: "Deny" }));
      const dialog = await screen.findByRole("dialog", { name: "Deny the stop of pricing-bot?" });
      await userEvent.click(within(dialog).getByRole("button", { name: "Deny stop" }));

      expect(trpcDouble.calls).toContainEqual({
        procedure: "governanceKillSwitch.denyStop",
        input: { organizationId: "org-1", stopId: "stop-2" },
      });
      expect(
        screen.getByRole("dialog", { name: "Deny the stop of pricing-bot?" }),
      ).toBeInTheDocument();
    });

    /** @scenario "The agents inventory shows a quarantined agent's status and pending approvals" */
    it("restores the quarantined agent after a confirm", async () => {
      answerMutation("governanceKillSwitch.restore", () => ({
        ...QUARANTINED,
        status: "restoring",
      }));
      renderAgentsPage({ permissions: MANAGER });

      await openActions("support-bot");
      await userEvent.click(await screen.findByRole("menuitem", { name: /Restore/ }));
      const dialog = await screen.findByRole("alertdialog", { name: "Restore support-bot?" });
      await userEvent.click(within(dialog).getByRole("button", { name: "Restore agent" }));

      expect(trpcDouble.calls).toContainEqual({
        procedure: "governanceKillSwitch.restore",
        input: { organizationId: "org-1", stopId: "stop-1" },
      });
    });
  });
});

describe("the agent row menu of an agent whose stop is open", () => {
  /** @scenario "The agent row menu always offers a way to stop an open stop again" */
  it.each([
    ["quarantined", "Stop again"],
    ["stop_failed", "Retry stop"],
    ["restore_failed", "Retry stop"],
  ] as const)("offers %s agents %s beside Restore", async (status, label) => {
    answerAgentsPage({
      summaries: [summary({ agentId: "a1", openStop: { ...QUARANTINED, status } })],
      pendingApprovals: [],
    });
    renderAgentsPage({ permissions: MANAGER });

    await openActions("support-bot");

    expect(await screen.findByRole("menuitem", { name: new RegExp(label) })).toBeEnabled();
    expect(screen.getByRole("menuitem", { name: /Restore/ })).toBeInTheDocument();
  });

  /** @scenario "A failed stop is retried from the agent row menu" */
  it("retries a failed stop after a confirm", async () => {
    const failed = { ...QUARANTINED, status: "stop_failed" as const };
    answerAgentsPage({
      summaries: [summary({ agentId: "a1", openStop: failed })],
      pendingApprovals: [],
    });
    answerMutation("governanceKillSwitch.retryStop", () => ({ ...failed, status: "stopping" }));
    renderAgentsPage({ permissions: MANAGER });

    await openActions("support-bot");
    await userEvent.click(await screen.findByRole("menuitem", { name: /Retry stop/ }));
    const dialog = await screen.findByRole("alertdialog", { name: "Retry stop for support-bot?" });
    await userEvent.click(within(dialog).getByRole("button", { name: "Retry stop" }));

    expect(trpcDouble.calls).toContainEqual({
      procedure: "governanceKillSwitch.retryStop",
      input: { organizationId: "org-1", stopId: "stop-1" },
    });
  });
});

describe("the Restore dialog when the agent's open stop changes under it", () => {
  /** @scenario "The Restore dialog restores only the stop it was opened for" */
  it("goes away instead of retargeting another stop", async () => {
    let openStop = QUARANTINED;
    answerAgentsPage({ summaries: [summary({ agentId: "a1", openStop: QUARANTINED })] });
    answerQuery("governanceKillSwitch.summaries", () => [summary({ agentId: "a1", openStop })]);
    renderAgentsPage({ permissions: MANAGER });
    await openActions("support-bot");
    await userEvent.click(await screen.findByRole("menuitem", { name: /Restore/ }));
    await screen.findByRole("alertdialog", { name: "Restore support-bot?" });

    openStop = { ...QUARANTINED, id: "stop-3" };
    await act(async () => {
      await Promise.all(
        [...(trpcDouble.mounted.get("governanceKillSwitch.summaries") ?? [])].map((read) => read()),
      );
    });

    await waitFor(() =>
      expect(screen.queryByRole("alertdialog", { name: "Restore support-bot?" })).toBeNull(),
    );
    expect(trpcDouble.calls).toEqual([]);
  });
});

describe("a Restore that completes after its stop was replaced", () => {
  /** @scenario "A late Restore completion leaves the dialog opened after it" */
  it("leaves the Restore dialog of the newer stop open", async () => {
    let openStop = QUARANTINED;
    let finish: () => void = () => undefined;
    answerAgentsPage({ summaries: [summary({ agentId: "a1", openStop: QUARANTINED })] });
    answerQuery("governanceKillSwitch.summaries", () => [summary({ agentId: "a1", openStop })]);
    answerMutation(
      "governanceKillSwitch.restore",
      () =>
        new Promise((resolve) => {
          finish = () => resolve({ ...QUARANTINED, status: "restoring" });
        }),
    );
    const reread = () =>
      act(async () => {
        await Promise.all(
          [...(trpcDouble.mounted.get("governanceKillSwitch.summaries") ?? [])].map((read) =>
            read(),
          ),
        );
      });
    const host = renderAgentsPage({ permissions: MANAGER });
    await openActions("support-bot");
    await userEvent.click(await screen.findByRole("menuitem", { name: /Restore/ }));
    const first = await screen.findByRole("alertdialog", { name: "Restore support-bot?" });
    await userEvent.click(within(first).getByRole("button", { name: "Restore agent" }));
    openStop = { ...QUARANTINED, id: "stop-3" };
    await reread();
    await waitFor(() =>
      expect(screen.queryByRole("alertdialog", { name: "Restore support-bot?" })).toBeNull(),
    );

    await openActions("support-bot");
    await userEvent.click(await screen.findByRole("menuitem", { name: /Restore/ }));
    await screen.findByRole("alertdialog", { name: "Restore support-bot?" });
    const readsBefore = trpcDouble.reads.filter((read) => read.endsWith(".summaries")).length;
    await act(async () => finish());

    // The first Restore's toast, then its re-read: its close runs right after that re-read.
    await waitFor(() =>
      expect(host.recording.successes.map((notice) => notice.title)).toContain(
        "Restoring support-bot",
      ),
    );
    await waitFor(() =>
      expect(trpcDouble.reads.filter((read) => read.endsWith(".summaries")).length).toBe(
        readsBefore + 1,
      ),
    );
    await act(async () => undefined);
    expect(screen.getByRole("alertdialog", { name: "Restore support-bot?" })).toBeInTheDocument();
  });
});

describe("the Agents page when a kill switch read fails", () => {
  const unavailable = () => {
    throw handledError({ code: "service_unavailable", httpStatus: 503 });
  };

  it("says the stop state did not load and reads it again on Retry", async () => {
    answerAgentsPage();
    answerQuery("governanceKillSwitch.summaries", unavailable);
    renderAgentsPage({ permissions: MANAGER });

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Couldn't load the agents' stop state");
    answerQuery("governanceKillSwitch.summaries", () => [summary({ agentId: "a1" })]);
    await userEvent.click(within(alert).getByRole("button", { name: "Try again" }));

    expect(await screen.findByRole("button", { name: "Actions for support-bot" })).toBeVisible();
    expect(screen.queryByText("Couldn't load the agents' stop state")).toBeNull();
  });

  it("says the pending approvals did not load, with Retry", async () => {
    answerAgentsPage();
    answerQuery("governanceKillSwitch.pendingApprovals", unavailable);
    renderAgentsPage({ permissions: MANAGER });

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Couldn't load the stops waiting for approval");
    expect(within(alert).getByRole("button", { name: "Try again" })).toBeInTheDocument();
  });
});

describe("the Agents page of an organisation without the kill switch", () => {
  const killSwitchReads = () =>
    trpcDouble.reads.filter((read) => read.startsWith("governanceKillSwitch."));

  /** @scenario "An organisation below the Enterprise plan sees its agents with no kill switch" */
  it("asks no stop read, shows no error and offers no kill switch action below Enterprise", async () => {
    answerAgentsPage({ pendingApprovals: [PENDING] });
    renderAgentsPage({ permissions: MANAGER, plan: { isEnterprise: false, isLoading: false } });

    await screen.findAllByTestId("governance-agent-row");
    expect(killSwitchReads()).toEqual([]);
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByRole("button", { name: "Actions for support-bot" })).toBeNull();
    expect(screen.queryByTestId("stop-approvals-card")).toBeNull();
  });

  /** @scenario "An organisation below the Enterprise plan sees its agents with no kill switch" */
  it("waits for the plan before it asks a stop read", async () => {
    answerAgentsPage();
    renderAgentsPage({ permissions: MANAGER, plan: { isEnterprise: false, isLoading: true } });

    await screen.findAllByTestId("governance-agent-row");
    expect(killSwitchReads()).toEqual([]);
  });

  /** @scenario "An organisation below the Enterprise plan sees its agents with no kill switch" */
  it("reads a plan refusal of the stop reads as no kill switch, even with no agent yet", async () => {
    const planRefusal = () => {
      throw handledError({ code: "enterprise_plan_required", httpStatus: 403 });
    };
    answerAgentsPage();
    answerQuery("governanceAgents.list", () => []);
    answerQuery("governanceKillSwitch.summaries", planRefusal);
    answerQuery("governanceKillSwitch.pendingApprovals", planRefusal);
    renderAgentsPage({ permissions: MANAGER });

    expect(await screen.findByTestId("agents-empty")).toBeInTheDocument();
    await waitFor(() => expect(killSwitchReads()).toHaveLength(2));
    await act(async () => undefined);
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByText("Couldn't load the agents' stop state")).toBeNull();
    expect(screen.queryByText("Couldn't load the stops waiting for approval")).toBeNull();
  });

  /** @scenario "An organisation below the Enterprise plan sees its agents with no kill switch" */
  it("offers no kill switch action on a row when the stop reads are refused for the plan", async () => {
    const planRefusal = () => {
      throw handledError({ code: "enterprise_plan_required", httpStatus: 402 });
    };
    answerAgentsPage();
    answerQuery("governanceKillSwitch.summaries", planRefusal);
    answerQuery("governanceKillSwitch.pendingApprovals", planRefusal);
    renderAgentsPage({ permissions: MANAGER });

    await screen.findAllByTestId("governance-agent-row");
    await waitFor(() => expect(killSwitchReads()).toHaveLength(2));
    await act(async () => undefined);
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByRole("button", { name: "Actions for support-bot" })).toBeNull();
  });
});

describe("the Agents page when a stop read answers a server error", () => {
  const serverError = () => {
    throw retryingFailure(new Error("INTERNAL_SERVER_ERROR"));
  };

  /** @scenario "A failing stop read shows its error and offers no action on the stop state it lacks" */
  it("says both stop reads failed while they retry, and offers no stop action", async () => {
    answerAgentsPage({
      summaries: [summary({ agentId: "a1", openStop: QUARANTINED })],
      pendingApprovals: [PENDING],
    });
    answerQuery("governanceKillSwitch.summaries", serverError);
    answerQuery("governanceKillSwitch.pendingApprovals", serverError);
    renderAgentsPage({ permissions: MANAGER });

    const alerts = await screen.findAllByRole("alert");
    const text = alerts.map((alert) => alert.textContent).join(" ");
    expect(text).toContain("Couldn't load the agents' stop state");
    expect(text).toContain("Couldn't load the stops waiting for approval");
    await screen.findAllByTestId("governance-agent-row");
    expect(screen.queryByRole("button", { name: "Actions for support-bot" })).toBeNull();
    expect(screen.queryByTestId("agent-stop-status")).toBeNull();
    expect(screen.queryByTestId("stop-approvals-card")).toBeNull();
  });

  /** @scenario "A failing stop read shows its error and offers no action on the stop state it lacks" */
  it("drops the stop state it showed once a later read fails", async () => {
    answerAgentsPage({ summaries: [summary({ agentId: "a1", openStop: QUARANTINED })] });
    renderAgentsPage({ permissions: MANAGER });
    expect(await screen.findByTestId("agent-stop-status")).toHaveTextContent("Quarantined");

    answerQuery("governanceKillSwitch.summaries", serverError);
    await act(async () => {
      await Promise.all(
        [...(trpcDouble.mounted.get("governanceKillSwitch.summaries") ?? [])].map((run) => run()),
      );
    });

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Couldn't load the agents' stop state",
    );
    expect(screen.queryByTestId("agent-stop-status")).toBeNull();
    expect(screen.queryByRole("button", { name: "Actions for support-bot" })).toBeNull();
  });
});

describe("the Agents page after a stop is sent", () => {
  const summaryReads = () => trpcDouble.reads.filter((read) => read.endsWith(".summaries")).length;

  it("reads the stop state and the approvals again, and sets no timer of its own", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    let stopped = false;
    answerAgentsPage();
    answerQuery("governanceKillSwitch.summaries", () => [
      summary({
        agentId: "a1",
        openStop: stopped
          ? stopOf({ id: "stop-9", agentId: "a1", agentName: "support-bot", status: "stopping" })
          : null,
      }),
    ]);
    answerMutation("governanceKillSwitch.requestStop", () => {
      stopped = true;
      return stopOf({ id: "stop-9", agentId: "a1", agentName: "support-bot", status: "stopping" });
    });
    const { dialog } = await openStopDialog();
    await within(dialog).findByTestId("stop-agent-targets");
    const readsBeforeStop = summaryReads();
    await userEvent.type(within(dialog).getByRole("textbox", { name: "Reason" }), "Leaking data");
    await userEvent.click(within(dialog).getByRole("button", { name: "Stop agent" }));

    expect(trpcDouble.invalidated).toEqual(
      expect.arrayContaining([
        "governanceKillSwitch.summaries",
        "governanceKillSwitch.pendingApprovals",
      ]),
    );
    expect(await within(rowOf("support-bot")).findByTestId("agent-stop-status")).toHaveTextContent(
      "Stopping",
    );
    const readsAfterStop = summaryReads();
    expect(readsAfterStop).toBe(readsBeforeStop + 1);

    await act(() => vi.advanceTimersByTimeAsync(60_000));
    expect(summaryReads()).toBe(readsAfterStop);
  });
});

type StopTargetOutcome = AgentStopView["targets"][number];

const outcomeOf = ({
  id,
  label,
  virtualKeyId,
  state = "pending",
}: {
  id: string;
  label: string;
  virtualKeyId: string;
  state?: StopTargetOutcome["state"];
}): StopTargetOutcome => ({
  id,
  label,
  target: { kind: "gateway_virtual_key", virtualKeyId },
  state,
  errorCode: null,
  appliedAt: state === "applied" ? "2026-11-16T09:01:00.000Z" : null,
  revertedAt: null,
});

const pendingWith = ({
  id,
  agentId,
  agentName,
  targets,
}: {
  id: string;
  agentId: string;
  agentName: string;
  targets: StopTargetOutcome[];
}): AgentStopView => ({
  ...stopOf({ id, agentId, agentName, status: "pending_approval" }),
  targets,
});

const approvalRowOf = async (name: string) => {
  const card = await screen.findByTestId("stop-approvals-card");
  const row = within(card)
    .getAllByTestId("stop-approval-row")
    .find((candidate) => candidate.getAttribute("data-agent") === name);
  if (!row) throw new Error(`no approval row for ${name}`);
  return row;
};

const approveOf = async (name: string) =>
  within(await approvalRowOf(name)).getByRole("button", { name: "Approve" });

describe("the approval card of a stop waiting for a decision", () => {
  const PRICING = pendingWith({
    id: "stop-2",
    agentId: "a2",
    agentName: "pricing-bot",
    targets: [
      outcomeOf({ id: "o1", label: "Pricing key", virtualKeyId: "vk-2" }),
      outcomeOf({ id: "o2", label: "Pricing fallback key", virtualKeyId: "vk-3" }),
    ],
  });

  /** @scenario "The approver sees the targets of the stop and approves exactly those" */
  it("names the stop's targets and approves with their ids", async () => {
    answerAgentsPage({
      summaries: [summary({ agentId: "a1" }), summary({ agentId: "a2", openStop: PRICING })],
      pendingApprovals: [PRICING],
    });
    answerMutation("governanceKillSwitch.approveStop", () => ({ ...PRICING, status: "stopping" }));
    renderAgentsPage({ permissions: MANAGER });

    const row = await approvalRowOf("pricing-bot");
    const targets = within(row).getByTestId("stop-agent-targets");
    expect(targets).toHaveTextContent("Pricing key (Gateway virtual key)");
    expect(targets).toHaveTextContent("Pricing fallback key (Gateway virtual key)");
    await userEvent.click(within(row).getByRole("button", { name: "Approve" }));

    expect(trpcDouble.calls).toContainEqual({
      procedure: "governanceKillSwitch.approveStop",
      input: { organizationId: "org-1", stopId: "stop-2", expectedTargetIds: ["o1", "o2"] },
    });
  });

  /** @scenario "The approver sees the targets of the stop and approves exactly those" */
  it("says the stop changed, shows its targets now, and approves those on the next press", async () => {
    let pending = PRICING;
    let refused = false;
    answerAgentsPage({
      summaries: [summary({ agentId: "a1" }), summary({ agentId: "a2", openStop: PRICING })],
    });
    answerQuery("governanceKillSwitch.pendingApprovals", () => [pending]);
    answerMutation("governanceKillSwitch.approveStop", () => {
      if (refused) return { ...pending, status: "stopping" };
      refused = true;
      pending = { ...PRICING, targets: PRICING.targets.slice(0, 1) };
      throw handledError({ code: "agent_stop_plan_changed", httpStatus: 409 });
    });
    const host = renderAgentsPage({ permissions: MANAGER });

    await userEvent.click(await approveOf("pricing-bot"));

    expect(
      await within(await approvalRowOf("pricing-bot")).findByText("The stop plan changed"),
    ).toBeVisible();
    await waitFor(async () =>
      expect(
        within(await approvalRowOf("pricing-bot")).getByTestId("stop-agent-targets"),
      ).not.toHaveTextContent("Pricing fallback key"),
    );
    expect(host.recording.failures).toEqual([]);
    await userEvent.click(await approveOf("pricing-bot"));
    expect(trpcDouble.calls.map((call) => call.input)).toEqual([
      { organizationId: "org-1", stopId: "stop-2", expectedTargetIds: ["o1", "o2"] },
      { organizationId: "org-1", stopId: "stop-2", expectedTargetIds: ["o1"] },
    ]);
  });

  /** @scenario "Each approval holds its own row until it settles" */
  it("keeps the first row busy and unpressable while a second row's approval settles", async () => {
    const support = pendingWith({
      id: "stop-1",
      agentId: "a1",
      agentName: "support-bot",
      targets: [],
    });
    const pricing = { ...PRICING, targets: [] };
    answerAgentsPage({
      summaries: [
        summary({ agentId: "a1", openStop: support }),
        summary({ agentId: "a2", openStop: pricing }),
      ],
      pendingApprovals: [support, pricing],
    });
    const finish = new Map<string, () => void>();
    answerMutation(
      "governanceKillSwitch.approveStop",
      (input) =>
        new Promise((resolve) => {
          const { stopId } = input as { stopId: string };
          finish.set(stopId, () => resolve({ ...support, id: stopId, status: "stopping" }));
        }),
    );
    renderAgentsPage({ permissions: MANAGER });
    const approvalsOf = (stopId: string) =>
      trpcDouble.calls.filter((call) => (call.input as { stopId: string }).stopId === stopId);

    await userEvent.click(await approveOf("support-bot"));
    await userEvent.click(await approveOf("pricing-bot"));
    await act(async () => finish.get("stop-2")?.());
    await waitFor(async () => expect(await approveOf("pricing-bot")).toBeEnabled());

    expect(await approveOf("support-bot")).toBeDisabled();
    fireEvent.click(await approveOf("support-bot"));
    expect(approvalsOf("stop-1")).toHaveLength(1);

    await act(async () => finish.get("stop-1")?.());
    await waitFor(async () => expect(await approveOf("support-bot")).toBeEnabled());
  });
});

describe("the Restore and Retry dialogs while their call runs", () => {
  /** @scenario "The Restore and Retry dialogs stay open until their call settles" */
  it.each([
    ["restore", /Restore/, "Restore support-bot?", "Restore agent", "quarantined"],
    ["retryStop", /Retry stop/, "Retry stop for support-bot?", "Retry stop", "stop_failed"],
  ] as const)(
    "keeps the %s confirm open on Escape",
    async (procedure, menuItem, title, confirm, status) => {
      answerAgentsPage({
        summaries: [summary({ agentId: "a1", openStop: { ...QUARANTINED, status } })],
      });
      answerMutation(`governanceKillSwitch.${procedure}`, () => new Promise(() => undefined));
      renderAgentsPage({ permissions: MANAGER });
      await openActions("support-bot");
      await userEvent.click(await screen.findByRole("menuitem", { name: menuItem }));
      const dialog = await screen.findByRole("alertdialog", { name: title });

      await userEvent.click(within(dialog).getByRole("button", { name: confirm }));
      await userEvent.keyboard("{Escape}");

      expect(screen.getByRole("alertdialog", { name: title })).toBeInTheDocument();
      expect(within(dialog).getByRole("button", { name: "Cancel" })).toBeDisabled();
    },
  );
});

describe("the Restore dialog of an agent sharing a key with an agent no row backs", () => {
  /** @scenario "The restore dialog names the stopped agents that keep a shared target off" */
  it("names the other stopped agent", async () => {
    const shared = (id: string) =>
      outcomeOf({ id, label: "Shared key", virtualKeyId: "vk-1", state: "applied" });
    const support = { ...QUARANTINED, targets: [shared("o1")] };
    const billing = {
      ...stopOf({ id: "stop-7", agentId: "a7", agentName: "billing-bot", status: "quarantined" }),
      targets: [shared("o7")],
    };
    answerAgentsPage({
      summaries: [
        summary({ agentId: "a1", openStop: support }),
        summary({ agentId: "a7", inventoryRowId: null, openStop: billing }),
      ],
    });
    renderAgentsPage({ permissions: MANAGER });

    await openActions("support-bot");
    await userEvent.click(await screen.findByRole("menuitem", { name: /Restore/ }));
    const dialog = await screen.findByRole("alertdialog", { name: "Restore support-bot?" });

    expect(within(dialog).getByTestId("restore-shared-target-note")).toHaveTextContent(
      "The virtual key stays disabled while billing-bot is still stopped.",
    );
  });
});
