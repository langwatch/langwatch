/**
 * @vitest-environment jsdom
 * The action buttons on an insight card, over the real tRPC hooks: what the card shows before
 * a click, that only a click sends, and once, and when no button shows at all.
 * @see modules/insight/specs/insight-actions.feature
 */

import { type UiProcedureCall, UiProcedureRefusal } from "@langwatch/browser/testing-transport";
import type { InsightActionRun } from "@langwatch/insight-contract";
import { nowInstant } from "@langwatch/time";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { ANOTHER_ACTION_SENDING } from "../../../model/insight-presentation.ts";
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
const CHECK_LATENCY = {
  id: "a0",
  label: "Check the latency",
  prompt: "Find the slowest traces from the last day.",
};
const WITH_ACTIONS = insightEntry({ seenAt: NOW, actions: [FIND_TRACES, DRAFT_EVALUATOR] });
const MAY_USE_LANGY = ["analytics:view", "langy:create"];

type InboxEntries = ReturnType<typeof insightEntry>[];

/** Answers the inbox read; each action run waits until the test answers it. */
function project({ entries }: { entries: InboxEntries }) {
  const calls: UiProcedureCall[] = [];
  const pending: ((run: InsightActionRun) => void)[] = [];
  const heldReads: ((held: InboxEntries) => void)[] = [];
  let read = (): Promise<InboxEntries> => Promise.resolve(entries);
  const answer = (call: UiProcedureCall) => {
    calls.push(call);
    if (call.path === "insights.getAll") return read();
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
    /** What every read from now on answers. */
    answerReadsWith: (next: () => Promise<InboxEntries>) => {
      read = next;
    },
    /** Reads from now on wait for `answerHeldReads`. */
    holdReads: () => {
      read = () => new Promise<InboxEntries>((resolve) => heldReads.push(resolve));
    },
    answerHeldReads: (held: InboxEntries) => {
      for (const answerRead of heldReads.splice(0)) answerRead(held);
    },
  };
}

function renderInbox({
  entries = [WITH_ACTIONS],
  actionsEnabled = true,
  permissions = MAY_USE_LANGY,
}: {
  entries?: InboxEntries;
  actionsEnabled?: boolean;
  permissions?: readonly string[];
} = {}) {
  const inbox = project({ entries });
  const { host, unmount, queryClient } = renderWithInsightHost({
    element: <InsightsScreen />,
    answer: inbox.answer,
    host: new StubInsightHost({ actionsEnabled, permissions }),
  });
  return { ...inbox, host, unmount, queryClient };
}

const IN_PLACE = { sourceGone: false, forkNotReady: false, forkTitle: null };
const ANSWERED = { conversationId: "conversation-1", turnId: "turn-1", ...IN_PLACE };

/** A click on its way, on the inbox the test then moves through the read's other states. */
async function renderWithClickOnItsWay() {
  const inbox = renderInbox();
  await userEvent.click(await screen.findByRole("button", { name: FIND_TRACES.label }));
  await waitFor(() => expect(inbox.runs()).toHaveLength(1));
  return inbox;
}

type InboxWithClick = Awaited<ReturnType<typeof renderWithClickOnItsWay>>;

async function failTheRead({ answerReadsWith, queryClient }: InboxWithClick) {
  // A 400, which the read does not retry: the page swaps as soon as it answers.
  answerReadsWith(() => Promise.reject(new UiProcedureRefusal("validation_error", 400)));
  void queryClient.invalidateQueries();
  expect(await screen.findByText("The inbox didn't load.")).toBeInTheDocument();
}

async function startTheReadOver({ holdReads, queryClient }: InboxWithClick) {
  holdReads();
  void queryClient.resetQueries();
  expect(await screen.findByTestId("insights-loading")).toBeInTheDocument();
}

async function emptyTheRead({ answerReadsWith, queryClient }: InboxWithClick) {
  answerReadsWith(() => Promise.resolve([]));
  void queryClient.invalidateQueries();
  expect(await screen.findByTestId("insights-day-zero")).toBeInTheDocument();
}

/** Brings the list back; the click's other action stands in for it, since it shows no spinner. */
async function bringTheListBack(inbox: InboxWithClick) {
  inbox.answerReadsWith(() => Promise.resolve([WITH_ACTIONS]));
  inbox.answerHeldReads([WITH_ACTIONS]);
  void inbox.queryClient.invalidateQueries();
  return screen.findByRole("button", { name: DRAFT_EVALUATOR.label });
}

async function expectTheConversationOpened({ answerRun, host }: InboxWithClick) {
  answerRun(ANSWERED);
  await waitFor(() => expect(host.openedConversations).toEqual(["conversation-1"]));
  expect(host.successes).toEqual([]);
}

async function expectTheActionsStillWait(inbox: InboxWithClick) {
  const other = await bringTheListBack(inbox);
  expect(other).toBeDisabled();
  fireEvent.click(other);
  expect(inbox.runs()).toHaveLength(1);
  inbox.answerRun(ANSWERED);
  await waitFor(() => expect(other).toBeEnabled());
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

  describe("when its owner clicks an action on one insight while another is in the inbox", () => {
    /** @scenario "While one action is on its way, every insight's actions wait" */
    it("disables the other insight's actions and says why, until the click answers", async () => {
      const second = insightEntry({
        id: "insight-2",
        title: "Latency rose",
        seenAt: NOW,
        actions: [CHECK_LATENCY],
      });
      const { answerRun, runs } = renderInbox({ entries: [WITH_ACTIONS, second] });

      await userEvent.click(await screen.findByRole("button", { name: FIND_TRACES.label }));
      await waitFor(() => expect(runs()).toHaveLength(1));
      const waiting = screen.getByRole("button", { name: CHECK_LATENCY.label });

      expect(waiting).toBeDisabled();
      expect(screen.getAllByText(ANOTHER_ACTION_SENDING)).toHaveLength(1);

      answerRun({ conversationId: "conversation-1", turnId: "turn-1", ...IN_PLACE });
      await waitFor(() => expect(waiting).toBeEnabled());
      expect(screen.queryByText(ANOTHER_ACTION_SENDING)).not.toBeInTheDocument();
    });
  });

  describe("when the click answers that the source conversation is gone", () => {
    /** @scenario "A click opens the conversation in Langy, and says when the original is gone" */
    it("opens Langy on the new conversation, and says the original is gone", async () => {
      const { answerRun, host, runs } = renderInbox();

      await userEvent.click(await screen.findByRole("button", { name: FIND_TRACES.label }));
      await waitFor(() => expect(runs()).toHaveLength(1));
      answerRun({
        conversationId: "conversation-new",
        turnId: "turn-1",
        ...IN_PLACE,
        sourceGone: true,
      });

      await waitFor(() => expect(host.openedConversations).toEqual(["conversation-new"]));
      expect(host.successes.map((notice) => notice.title)).toEqual([
        "The original conversation is gone",
      ]);
    });
  });

  describe("when the click answers that the fork did not get ready in time", () => {
    /** @scenario "A click whose fork was not ready says a new conversation started, and names the copy" */
    it("opens Langy on the new conversation, says the copy was late, and not that the original is gone", async () => {
      const { answerRun, host, runs } = renderInbox();

      await userEvent.click(await screen.findByRole("button", { name: FIND_TRACES.label }));
      await waitFor(() => expect(runs()).toHaveLength(1));
      answerRun({
        conversationId: "conversation-new",
        turnId: "turn-1",
        ...IN_PLACE,
        forkNotReady: true,
        forkTitle: "Checkout errors (fork)",
      });

      await waitFor(() => expect(host.openedConversations).toEqual(["conversation-new"]));
      expect(host.successes).toEqual([
        {
          title: "Langy started a new conversation from this insight",
          description: expect.stringContaining('"Checkout errors (fork)"'),
        },
      ]);
      expect(host.successes[0]?.description).toContain("did not get ready in time");
    });
  });

  describe("when the person leaves the page, and then the click answers", () => {
    /** @scenario "A click that answers after the person left the page leaves them where they are, and says where the conversation is" */
    it("does not touch the address, and points them to Recent chats in the Langy panel", async () => {
      const { answerRun, host, runs, unmount } = renderInbox();

      await userEvent.click(await screen.findByRole("button", { name: FIND_TRACES.label }));
      await waitFor(() => expect(runs()).toHaveLength(1));
      unmount();
      answerRun({ conversationId: "conversation-1", turnId: "turn-1", ...IN_PLACE });

      await waitFor(() =>
        expect(host.successes).toEqual([
          {
            title: "Langy has your action",
            description: "Find the conversation under Recent chats in the Langy panel.",
          },
        ]),
      );
      expect(host.openedConversations).toEqual([]);
      expect(host.queries).toEqual([]);
      expect(host.navigations).toEqual([]);
    });
  });
});

describe("given an action on its way, and an inbox read that has failed", () => {
  describe("when the click answers", () => {
    /** @scenario "A click that answers while the inbox shows its load failure still opens the conversation" */
    it("opens the conversation, and does not say they left the page", async () => {
      const inbox = await renderWithClickOnItsWay();
      await failTheRead(inbox);

      await expectTheConversationOpened(inbox);
    });
  });

  describe("when a later read brings the list back, before the click answers", () => {
    /** @scenario "The actions keep waiting after a failed inbox read comes back" */
    it("keeps the actions disabled until the click answers", async () => {
      const inbox = await renderWithClickOnItsWay();
      await failTheRead(inbox);

      await expectTheActionsStillWait(inbox);
    });
  });
});

describe("given an action on its way, and an inbox read that has to start over", () => {
  describe("when the click answers while the skeleton shows", () => {
    /** @scenario "A click that answers while the inbox shows its skeleton still opens the conversation" */
    it("opens the conversation, and does not say they left the page", async () => {
      const inbox = await renderWithClickOnItsWay();
      await startTheReadOver(inbox);

      await expectTheConversationOpened(inbox);
    });
  });

  describe("when the read brings the list back, before the click answers", () => {
    /** @scenario "The actions keep waiting after the skeleton gives way to the list" */
    it("keeps the actions disabled until the click answers", async () => {
      const inbox = await renderWithClickOnItsWay();
      await startTheReadOver(inbox);

      await expectTheActionsStillWait(inbox);
    });
  });
});

describe("given an action on its way, and an inbox read that holds no insights any more", () => {
  describe("when the click answers while the empty page shows", () => {
    /** @scenario "A click that answers once no insight is left still opens the conversation" */
    it("opens the conversation, and does not say they left the page", async () => {
      const inbox = await renderWithClickOnItsWay();
      await emptyTheRead(inbox);

      await expectTheConversationOpened(inbox);
    });
  });

  describe("when a later read brings an insight back, before the click answers", () => {
    /** @scenario "The actions keep waiting when an insight lands on the empty page" */
    it("keeps the actions disabled until the click answers", async () => {
      const inbox = await renderWithClickOnItsWay();
      await emptyTheRead(inbox);

      await expectTheActionsStillWait(inbox);
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
