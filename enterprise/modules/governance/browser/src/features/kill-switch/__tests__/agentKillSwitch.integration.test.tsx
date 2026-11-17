// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
// @vitest-environment jsdom
/**
 * The kill switch on the Agents page: a stop's status on its row, the approvals card, failed
 * reads with Retry, and the re-read each write ends with; later changes arrive as read hints.
 * Only the tRPC binding is doubled. Spec: enterprise/modules/governance/specs/agent-kill-switch.feature
 */
import "@testing-library/jest-dom/vitest";
import { act, cleanup, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  answerMutation,
  answerQuery,
  handledError,
  assertEveryCallConfigured,
  resetTrpcDouble,
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
        input: { organizationId: "org-1", stopId: "stop-2" },
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
      const dialog = await screen.findByRole("dialog", { name: "Restore support-bot?" });
      await userEvent.click(within(dialog).getByRole("button", { name: "Restore agent" }));

      expect(trpcDouble.calls).toContainEqual({
        procedure: "governanceKillSwitch.restore",
        input: { organizationId: "org-1", stopId: "stop-1" },
      });
    });
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
