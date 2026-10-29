/**
 * @vitest-environment jsdom
 * The action buttons on an insight card, over the real tRPC hooks: what the card shows before
 * a click, that only a click sends, and once, and when no button shows at all.
 * @see modules/insight/specs/insight-actions.feature
 */

import type { UiProcedureCall } from "@langwatch/browser/testing-transport";
import type { InsightActionRun } from "@langwatch/insight-contract";
import { nowInstant } from "@langwatch/time";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { insightEntry, renderWithInsightHost, StubInsightHost } from "../../../testing.tsx";
import InsightsScreen from "../insights.screen.tsx";

const NOW = nowInstant().epochMilliseconds;
const FIND_TRACES = {
  id: "a0",
  label: "Find the traces",
  prompt: "Find the failing checkout traces from the last day.",
};
const DRAFT_EVALUATOR = {
  id: "a1",
  label: "Draft an evaluator",
  prompt: "Draft an evaluator that flags a failed checkout.",
};
const WITH_ACTIONS = insightEntry({ seenAt: NOW, actions: [FIND_TRACES, DRAFT_EVALUATOR] });
const MAY_USE_LANGY = ["analytics:view", "langy:create"];

/** Answers the inbox read; each action run waits until the test answers it. */
function project({ entries }: { entries: ReturnType<typeof insightEntry>[] }) {
  const calls: UiProcedureCall[] = [];
  const pending: ((run: InsightActionRun) => void)[] = [];
  const answer = (call: UiProcedureCall) => {
    calls.push(call);
    if (call.path === "insights.getAll") return Promise.resolve(entries);
    if (call.path === "insights.markSeen") return Promise.resolve(null);
    if (call.path === "insights.runAction") {
      return new Promise<InsightActionRun>((resolve) => pending.push(resolve));
    }
    return Promise.reject(new Error(`No test answer for ${call.path}`));
  };
  return {
    answer,
    runs: () => calls.filter((call) => call.path === "insights.runAction"),
    answerRun: (run: InsightActionRun) => pending.shift()?.(run),
  };
}

function renderInbox({
  entries = [WITH_ACTIONS],
  actionsEnabled = true,
  permissions = MAY_USE_LANGY,
}: {
  entries?: ReturnType<typeof insightEntry>[];
  actionsEnabled?: boolean;
  permissions?: readonly string[];
} = {}) {
  const inbox = project({ entries });
  const { host } = renderWithInsightHost({
    element: <InsightsScreen />,
    answer: inbox.answer,
    host: new StubInsightHost({ actionsEnabled, permissions }),
  });
  return { ...inbox, host };
}

describe("given an insight with actions in the inbox", () => {
  describe("when the page draws", () => {
    /** @scenario "The card shows each action's prompt before any click, and sends nothing on its own" */
    it("shows each action's label and exact prompt, and sends nothing", async () => {
      const { runs } = renderInbox();

      expect(await screen.findByRole("button", { name: FIND_TRACES.label })).toBeEnabled();
      expect(screen.getByRole("button", { name: DRAFT_EVALUATOR.label })).toBeEnabled();
      expect(screen.getByText(FIND_TRACES.prompt)).toBeInTheDocument();
      expect(screen.getByText(DRAFT_EVALUATOR.prompt)).toBeInTheDocument();
      expect(runs()).toEqual([]);
    });
  });

  describe("when its owner clicks an action twice while the first click is on its way", () => {
    /** @scenario "One click sends the action once, however often it is clicked" */
    it("sends the action once, naming the insight and the action and never the prompt", async () => {
      const { runs } = renderInbox();
      const button = await screen.findByRole("button", { name: FIND_TRACES.label });

      // Two clicks in the same tick: the second lands before the button can render disabled.
      fireEvent.click(button);
      fireEvent.click(button);
      await waitFor(() => expect(runs()).toHaveLength(1));
      fireEvent.click(screen.getByText(DRAFT_EVALUATOR.label));

      expect(runs()).toHaveLength(1);
      expect(runs()[0]?.input).toEqual({
        projectId: "project-1",
        insightId: WITH_ACTIONS.id,
        actionId: "a0",
        clickId: expect.stringMatching(/^[0-9a-f]{32}$/),
      });
    });
  });

  describe("when the click answers that the source conversation is gone", () => {
    /** @scenario "A click opens the conversation in Langy, and says when the original is gone" */
    it("opens Langy on the new conversation, and says the original is gone", async () => {
      const { answerRun, host, runs } = renderInbox();

      await userEvent.click(await screen.findByRole("button", { name: FIND_TRACES.label }));
      await waitFor(() => expect(runs()).toHaveLength(1));
      answerRun({ conversationId: "conversation-new", turnId: "turn-1", sourceGone: true });

      await waitFor(() => expect(host.openedConversations).toEqual(["conversation-new"]));
      expect(host.successes.map((notice) => notice.title)).toEqual([
        "The original conversation is gone",
      ]);
    });
  });
});

describe("given the release_insight_actions flag is off", () => {
  describe("when the page draws an insight with actions", () => {
    /** @scenario "No action shows while release_insight_actions is off" */
    it("shows no action button", async () => {
      renderInbox({ actionsEnabled: false });

      expect(await screen.findByText(WITH_ACTIONS.title)).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: FIND_TRACES.label })).not.toBeInTheDocument();
      expect(screen.queryByText(FIND_TRACES.prompt)).not.toBeInTheDocument();
    });
  });
});

describe("given an insight a daily run filed", () => {
  describe("when the page draws it", () => {
    /** @scenario "No action shows on an insight a run filed" */
    it("shows no action button, whatever the insight holds", async () => {
      renderInbox({
        entries: [{ ...WITH_ACTIONS, filedVia: "run", filedByUserId: null }],
      });

      expect(await screen.findByText(WITH_ACTIONS.title)).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: FIND_TRACES.label })).not.toBeInTheDocument();
    });
  });
});

describe("given a member without langy:create", () => {
  describe("when the page draws an insight with actions", () => {
    /** @scenario "Without langy:create the actions are disabled and say why" */
    it("disables the buttons and says they need permission to use Langy", async () => {
      const { runs } = renderInbox({ permissions: ["analytics:view"] });

      expect(await screen.findByRole("button", { name: FIND_TRACES.label })).toBeDisabled();
      expect(screen.getByText("You need permission to use Langy")).toBeInTheDocument();
      expect(runs()).toEqual([]);
    });
  });
});
