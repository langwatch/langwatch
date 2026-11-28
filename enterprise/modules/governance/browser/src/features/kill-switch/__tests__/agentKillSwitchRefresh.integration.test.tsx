// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
// @vitest-environment jsdom
/**
 * How the Agents page's kill switch reads refresh, on the real tRPC hooks and a real QueryClient
 * with only the network answered by the test: a read hint, a write's re-read, and Try again.
 * Spec: enterprise/modules/governance/specs/agent-kill-switch.feature
 */
import "@testing-library/jest-dom/vitest";
import { createUiQueryClient } from "@langwatch/browser/query-client";
import { startUiQueryHints, type UiQueryHintStream } from "@langwatch/browser/query-hints";
import {
  answeringUiTransport,
  type UiProcedureCall,
  UiProcedureRefusal,
} from "@langwatch/browser/testing-transport";
import type {
  AgentKillSwitchSummary,
  AgentStopView,
} from "@langwatch/enterprise-governance-contract";
import { act, cleanup, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { governanceApi } from "../../../behavior/governance-api.ts";
import { fakeGovernanceHost, renderWithGovernanceHost } from "../../../testing.tsx";
import AgentsPage from "../../../ui/sections/governance/agents.tsx";
import {
  agentRow,
  MANAGER,
  openActions,
  rowOf,
  stopOf,
  summary,
  SUPPORT_BOT_PLAN,
} from "./kill-switch-fixtures.tsx";

vi.mock("@langwatch/browser-host/drawer", async () => ({
  ...(await vi.importActual("@langwatch/browser-host/drawer")),
  useDrawer: () => ({ openDrawer: vi.fn(), closeDrawer: vi.fn(), goBack: vi.fn() }),
}));

type Answer = (input: unknown) => unknown;

/** The server as the wire reaches it: one answer per procedure path, and every call it got. */
const server = {
  answers: new Map<string, Answer>(),
  calls: [] as UiProcedureCall[],
};
const answer = (path: string, handler: Answer) => server.answers.set(path, handler);
const callsTo = (path: string) => server.calls.filter((call) => call.path === path);

const STOPPING = stopOf({
  id: "stop-1",
  agentId: "a1",
  agentName: "support-bot",
  status: "stopping",
});
const PENDING = stopOf({
  id: "stop-2",
  agentId: "a2",
  agentName: "pricing-bot",
  status: "pending_approval",
});

function answerAgentsPage({
  summaries,
  pendingApprovals = () => [],
}: {
  summaries: () => AgentKillSwitchSummary[];
  pendingApprovals?: () => AgentStopView[];
}) {
  answer("governanceAgents.list", () => [
    agentRow("a1", "support-bot"),
    agentRow("a2", "pricing-bot"),
  ]);
  answer("governanceAgents.syncSources", () => []);
  answer("governanceKillSwitch.summaries", summaries);
  answer("governanceKillSwitch.pendingApprovals", pendingApprovals);
  answer("governanceKillSwitch.plan", () => SUPPORT_BOT_PLAN);
  answer("governanceKillSwitch.awsConnections", () => []);
}

/** The read hint stream as presence holds it for the tab; `raise` delivers one hint. */
function hintStream() {
  let deliver: ((hint: unknown) => void) | undefined;
  const stream: UiQueryHintStream = ({ onHint }) => {
    deliver = onHint;
    return () => {
      deliver = undefined;
    };
  };
  return {
    stream,
    raise: (path: string) => {
      if (!deliver) throw new Error("the hint stream is not open");
      deliver({ path });
    },
  };
}

let stopHints: () => void = () => undefined;

/** The Agents page as the shell mounts it: real hooks, real cache, the shell's hint wiring. */
function renderAgentsPage() {
  const queryClient = createUiQueryClient({ onMutationError: () => undefined });
  const hints = hintStream();
  stopHints = startUiQueryHints({ queryClient, stream: hints.stream, channel: undefined });
  const transport = answeringUiTransport(async (call) => {
    server.calls.push(call);
    const handler = server.answers.get(call.path);
    if (!handler) throw new Error(`No test answer for ${call.path}`);
    return handler(call.input);
  });
  const host = fakeGovernanceHost({ permissions: MANAGER });
  renderWithGovernanceHost(
    <governanceApi.Provider client={transport} queryClient={queryClient}>
      <>
        <MemoryRouter initialEntries={["/governance/agents"]}>
          <AgentsPage />
        </MemoryRouter>
      </>
    </governanceApi.Provider>,
    { host },
  );
  return { host, hints };
}

const statusOf = (name: string) => within(rowOf(name)).findByTestId("agent-stop-status");

beforeEach(() => {
  window.sessionStorage.clear();
  server.answers.clear();
  server.calls = [];
});

afterEach(() => {
  stopHints();
  cleanup();
});

describe("the Agents page while a stop moves on the worker", () => {
  /** @scenario "The Agents page follows a stop through its read hints" */
  it("reads the stop state again on its read hint and shows the new status", async () => {
    let openStop: AgentStopView = STOPPING;
    answerAgentsPage({ summaries: () => [summary({ agentId: "a1", openStop })] });
    const { hints } = renderAgentsPage();
    await screen.findAllByTestId("governance-agent-row");
    expect(await statusOf("support-bot")).toHaveTextContent("Stopping");
    const reads = callsTo("governanceKillSwitch.summaries").length;

    openStop = { ...STOPPING, status: "quarantined" };
    await act(async () => hints.raise("governanceKillSwitch.summaries"));

    await waitFor(async () =>
      expect(await statusOf("support-bot")).toHaveTextContent("Quarantined"),
    );
    expect(callsTo("governanceKillSwitch.summaries")).toHaveLength(reads + 1);
  });

  /** @scenario "The Agents page follows a stop through its read hints" */
  it("drops a decided stop from the approvals card on its read hint", async () => {
    let pending: AgentStopView[] = [PENDING];
    answerAgentsPage({
      summaries: () => [summary({ agentId: "a2", openStop: pending[0] ?? null })],
      pendingApprovals: () => pending,
    });
    const { hints } = renderAgentsPage();
    expect(await screen.findByTestId("stop-approvals-card")).toBeInTheDocument();

    pending = [];
    await act(async () => hints.raise("governanceKillSwitch.pendingApprovals"));

    await waitFor(() => expect(screen.queryByTestId("stop-approvals-card")).toBeNull());
  });

  /** @scenario "The Agents page follows a stop through its read hints" */
  it("leaves the stop reads alone on a hint for another read", async () => {
    answerAgentsPage({ summaries: () => [summary({ agentId: "a1", openStop: STOPPING })] });
    const { hints } = renderAgentsPage();
    await screen.findAllByTestId("governance-agent-row");
    await statusOf("support-bot");
    const reads = callsTo("governanceKillSwitch.summaries").length;

    await act(async () => hints.raise("governanceKillSwitch.awsConnections"));

    expect(callsTo("governanceKillSwitch.summaries")).toHaveLength(reads);
  });
});

describe("the Agents page after a write", () => {
  /** @scenario "Approving a stop reads the stop state and the approvals again" */
  it("reads the approvals and the stop state again once a stop is approved", async () => {
    let approved = false;
    answerAgentsPage({
      summaries: () => [
        summary({
          agentId: "a2",
          openStop: { ...PENDING, status: approved ? "stopping" : PENDING.status },
        }),
      ],
      pendingApprovals: () => (approved ? [] : [PENDING]),
    });
    answer("governanceKillSwitch.approveStop", () => {
      approved = true;
      return { ...PENDING, status: "stopping" };
    });
    renderAgentsPage();

    const card = await screen.findByTestId("stop-approvals-card");
    await userEvent.click(within(card).getByRole("button", { name: "Approve" }));

    await waitFor(() => expect(screen.queryByTestId("stop-approvals-card")).toBeNull());
    expect(await statusOf("pricing-bot")).toHaveTextContent("Stopping");
    expect(callsTo("governanceKillSwitch.pendingApprovals")).toHaveLength(2);
    expect(callsTo("governanceKillSwitch.summaries")).toHaveLength(2);
  });

  /** @scenario "Saving a stop plan reads the plan and the stop state again" */
  it("reads the plan and the summaries again once the plan is saved", async () => {
    let plan = SUPPORT_BOT_PLAN;
    answerAgentsPage({
      summaries: () => [summary({ agentId: "a1", planTargetCount: plan.targets.length })],
    });
    answer("governanceKillSwitch.plan", () => plan);
    answer("governanceKillSwitch.setPlan", () => {
      plan = { ...SUPPORT_BOT_PLAN, version: 4, targets: [] };
      return plan;
    });
    renderAgentsPage();
    await openActions("support-bot");
    await userEvent.click(await screen.findByRole("menuitem", { name: /Stop plan/ }));
    const dialog = await screen.findByRole("dialog", { name: "Stop plan for support-bot" });
    for (const name of ["Remove support-bot-prod", "Remove Support key"]) {
      await userEvent.click(await within(dialog).findByRole("button", { name }));
    }
    await userEvent.click(within(dialog).getByRole("button", { name: "Save plan" }));

    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "Stop plan for support-bot" })).toBeNull(),
    );
    expect(callsTo("governanceKillSwitch.setPlan")[0]?.input).toMatchObject({
      expectedVersion: 3,
      targets: [],
    });
    expect(callsTo("governanceKillSwitch.plan").length).toBeGreaterThanOrEqual(2);
    await openActions("support-bot");
    expect(await screen.findByRole("menuitem", { name: /Add a stop plan first/ })).toHaveAttribute(
      "data-disabled",
    );
  });
});

describe("the Agents page when a stop read fails", () => {
  /** @scenario "A failing stop read shows its error and offers no action on the stop state it lacks" */
  it("reads the stop state again on Try again", async () => {
    let failing = true;
    answerAgentsPage({
      summaries: () => {
        if (failing) throw new UiProcedureRefusal("service_unavailable", 503);
        return [summary({ agentId: "a1", openStop: STOPPING })];
      },
    });
    renderAgentsPage();

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Couldn't load the agents' stop state");
    failing = false;
    await userEvent.click(within(alert).getByRole("button", { name: "Try again" }));

    expect(await statusOf("support-bot")).toHaveTextContent("Stopping");
  });
});
