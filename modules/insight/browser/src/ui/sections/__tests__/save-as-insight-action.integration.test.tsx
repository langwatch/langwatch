/**
 * @vitest-environment jsdom
 * "Save as insight" under a Langy answer: who may save, what the filing carries of the board,
 * the widget and the query the answer was about, and what the saver is told.
 * @see modules/insight/specs/insight-inbox.feature
 */

import type { UiProcedureCall } from "@langwatch/browser/testing-transport";
import type { LangyAnswerSubject, LangyDerivedInsightsCard } from "@langwatch/langy-contract";
import { cleanup, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";

import { insightEntry, renderWithInsightHost, StubInsightHost } from "../../../testing.tsx";
import { SaveAsInsightAction } from "../save-as-insight-action.tsx";

const SUBJECT: LangyAnswerSubject = {
  board: {
    id: "board-1",
    name: "Checkout health",
    widget: { id: "widget-1", name: "Errors by day" },
  },
  evidence: {
    lwql: "SELECT count() FROM traces WHERE model = {model:String}",
    window: { start: 1_783_209_600_000, end: 1_785_801_600_000, granularitySeconds: 86_400 },
    period: "Last 30 days",
    parameters: { model: "gpt-5" },
  },
};

async function saveAnswer({ subject }: { subject?: LangyAnswerSubject }) {
  const filings: UiProcedureCall[] = [];
  // The harness's member holds `analytics:view` and no more.
  const { host } = renderWithInsightHost({
    element: (
      <SaveAsInsightAction
        projectId="project-1"
        conversationId="conversation-1"
        messageId="message-1"
        answerText="Checkout errors doubled overnight."
        {...(subject ? { subject } : {})}
      />
    ),
    answer: (call) => {
      if (call.path !== "insights.file")
        return Promise.reject(new Error(`No answer for ${call.path}`));
      filings.push(call);
      return Promise.resolve(insightEntry());
    },
  });
  await userEvent.click(screen.getByRole("button", { name: "Save as insight" }));
  await userEvent.click(await screen.findByRole("button", { name: "Save to Insights" }));
  await waitFor(() => expect(filings).toHaveLength(1));
  return { filed: filings[0]?.input, host };
}

/** An answer's insights card as Langy stamps it: one board, one window, three findings. */
const CARD: LangyDerivedInsightsCard = {
  kind: "insights",
  blockId: "daily-insights",
  board: { id: "board-1", name: "Checkout health" },
  window: { start: 1_783_209_600_000, end: 1_783_296_000_000, granularitySeconds: 3_600 },
  findings: [
    {
      title: "Checkout errors doubled",
      body: "Errors on checkout rose from 41 to 96 against the day before.",
      tone: "bad",
      topic: "errors",
      validDays: 10,
      widgetId: "widget-1",
      widgetName: "Errors by day",
      lwql: "SELECT countIf(HasError) FROM trace_metrics",
      key: "checkout-errors-doubled",
    },
    { title: "Latency crept up", body: "p95 rose from 1.2 to 1.6 seconds.", tone: "watch" },
    { title: "Cost per trace fell", body: "From 0.12 to 0.08 dollars.", tone: "good" },
  ],
};

/** Mounts the action under an answer that carries the card, and records what is filed. */
function mountCardAnswer({ card = CARD }: { card?: LangyDerivedInsightsCard } = {}) {
  const filings: UiProcedureCall[] = [];
  renderWithInsightHost({
    element: (
      <SaveAsInsightAction
        projectId="project-1"
        conversationId="conversation-1"
        messageId="message-1"
        answerText="I read each widget over the window. Nothing in this prose is a finding."
        insights={card}
      />
    ),
    answer: (call) => {
      if (call.path !== "insights.file")
        return Promise.reject(new Error(`No answer for ${call.path}`));
      filings.push(call);
      return Promise.resolve(insightEntry());
    },
  });
  return { filings };
}

const openDialog = () => userEvent.click(screen.getByRole("button", { name: "Save as insight" }));
const saveDialog = async () =>
  userEvent.click(await screen.findByRole("button", { name: "Save to Insights" }));

afterEach(cleanup);

describe("given a Langy answer that carries an insights card", () => {
  describe("when a member saves one of its findings", () => {
    /** @scenario "Saving a finding of an answer's insights card files its typed data" */
    it("files the finding's words, verdict, topic and validity, with the card's pointer, query and window", async () => {
      const { filings } = mountCardAnswer();

      await openDialog();
      await saveDialog();

      await waitFor(() => expect(filings).toHaveLength(1));
      expect(filings[0]?.input).toEqual({
        projectId: "project-1",
        title: "Checkout errors doubled",
        body: "Errors on checkout rose from 41 to 96 against the day before.",
        tone: "bad",
        topic: "errors",
        validDays: 10,
        source: { conversationId: "conversation-1", messageId: "message-1" },
        board: {
          id: "board-1",
          name: "Checkout health",
          widget: { id: "widget-1", name: "Errors by day" },
        },
        lwql: "SELECT countIf(HasError) FROM trace_metrics",
        replay: {
          start: 1_783_209_600_000,
          end: 1_783_296_000_000,
          granularitySeconds: 3_600,
          period: null,
          parameters: {},
        },
      });
    });

    /** @scenario "A member picks which finding of a card to save" */
    it("starts the form again from the finding they pick, and files that one", async () => {
      const { filings } = mountCardAnswer();

      await openDialog();
      await userEvent.selectOptions(
        await screen.findByRole("combobox", { name: "Finding" }),
        "Latency crept up",
      );
      expect(screen.getByRole("textbox", { name: "Headline" })).toHaveValue("Latency crept up");
      await saveDialog();

      await waitFor(() => expect(filings).toHaveLength(1));
      expect(filings[0]?.input).toMatchObject({
        title: "Latency crept up",
        body: "p95 rose from 1.2 to 1.6 seconds.",
        tone: "watch",
        validDays: 7,
        board: { id: "board-1", name: "Checkout health", widget: null },
      });
      expect(filings[0]?.input).not.toHaveProperty("lwql");
      expect(filings[0]?.input).not.toHaveProperty("replay");
      expect(filings[0]?.input).not.toHaveProperty("topic");
    });

    /** @scenario "A good finding of an insights card is never filed" */
    it("offers only the bad and the watch findings, never the good one", async () => {
      mountCardAnswer();

      await openDialog();

      const finding = await screen.findByRole("combobox", { name: "Finding" });
      const options = within(finding).getAllByRole("option");
      expect(options.map((option) => option.textContent)).toEqual([
        "Checkout errors doubled",
        "Latency crept up",
      ]);
    });

    /** @scenario "The save form offers no Good news" */
    it("offers no Good news as the verdict", async () => {
      mountCardAnswer();

      await openDialog();

      const verdict = await screen.findByRole("combobox", { name: "Verdict" });
      const options = within(verdict).getAllByRole("option");
      expect(options.map((option) => option.textContent)).toEqual(["Warning", "Worth a look"]);
    });

    it("offers the findings not saved yet, and says saved once every one is", async () => {
      const { filings } = mountCardAnswer();

      await openDialog();
      await saveDialog();
      await waitFor(() => expect(filings).toHaveLength(1));
      await openDialog();
      expect(await screen.findByRole("textbox", { name: "Headline" })).toHaveValue(
        "Latency crept up",
      );
      expect(
        screen.getByRole("option", { name: "Checkout errors doubled (saved)" }),
      ).toBeDisabled();
      await saveDialog();

      await waitFor(() => expect(filings).toHaveLength(2));
      expect(screen.getByRole("button", { name: "Saved as insight" })).toBeDisabled();
    });
  });

  describe("when the card names no board and no window", () => {
    it("files the finding's words and query with no pointer and no window", async () => {
      const { board: _board, window: _window, ...bare } = CARD;
      const { filings } = mountCardAnswer({ card: bare });

      await openDialog();
      await saveDialog();

      await waitFor(() => expect(filings).toHaveLength(1));
      expect(filings[0]?.input).toMatchObject({
        lwql: "SELECT countIf(HasError) FROM trace_metrics",
      });
      expect(filings[0]?.input).not.toHaveProperty("board");
      expect(filings[0]?.input).not.toHaveProperty("replay");
    });
  });

  describe("when the card holds good findings only", () => {
    /** @scenario "A good finding of an insights card is never filed" */
    it("draws no save action, so good news is never filed", () => {
      mountCardAnswer({ card: { ...CARD, findings: CARD.findings.slice(2) } });

      expect(screen.queryByRole("button", { name: "Save as insight" })).not.toBeInTheDocument();
    });
  });

  describe("when the card holds no finding", () => {
    /** @scenario "An answer without an insights card is saved from its text" */
    it("starts the form from the answer's own text, as an answer with no card does", async () => {
      mountCardAnswer({ card: { ...CARD, findings: [] } });

      await openDialog();

      expect(await screen.findByRole("textbox", { name: "Headline" })).toHaveValue(
        "I read each widget over the window. Nothing in this prose is a finding.",
      );
      expect(screen.queryByRole("combobox", { name: "Finding" })).not.toBeInTheDocument();
    });
  });
});

describe("given a Langy answer that names the board, the widget, the query and the window it read", () => {
  describe("when a member saves it as an insight", () => {
    /** @scenario "Saving a Langy answer about a board passes the pointer and the window" */
    it("files it with that board and widget, that query and that window", async () => {
      expect((await saveAnswer({ subject: SUBJECT })).filed).toMatchObject({
        projectId: "project-1",
        source: { conversationId: "conversation-1", messageId: "message-1" },
        board: {
          id: "board-1",
          name: "Checkout health",
          widget: { id: "widget-1", name: "Errors by day" },
        },
        lwql: "SELECT count() FROM traces WHERE model = {model:String}",
        replay: {
          start: 1_783_209_600_000,
          end: 1_785_801_600_000,
          granularitySeconds: 86_400,
          period: "Last 30 days",
          parameters: { model: "gpt-5" },
        },
      });
    });
  });
});

describe("given a Langy answer that names no board and no query", () => {
  describe("when a member saves it as an insight", () => {
    /**
     * @scenario "Saving a Langy answer about a board passes the pointer and the window"
     * @scenario "An answer without an insights card is saved from its text"
     */
    it("files it with no pointer, no query and no window", async () => {
      const { filed } = await saveAnswer({});

      expect(filed).toMatchObject({
        projectId: "project-1",
        title: "Checkout errors doubled overnight.",
        body: "Checkout errors doubled overnight.",
        tone: "watch",
      });
      expect(filed).not.toHaveProperty("board");
      expect(filed).not.toHaveProperty("lwql");
      expect(filed).not.toHaveProperty("replay");
    });
  });
});

describe("given a member with analytics:view and no more", () => {
  describe("when they save a Langy answer as an insight", () => {
    /** @scenario "Saving a Langy answer says only the saver sees the insight" */
    it("tells them it is saved and that only they see it", async () => {
      const { host } = await saveAnswer({});

      await waitFor(() =>
        expect(host.successes).toEqual([
          { title: "Saved to Insights", description: "Only you see it, in your inbox." },
        ]),
      );
    });
  });

  describe("when they hold no analytics:view", () => {
    it("draws no action", () => {
      renderWithInsightHost({
        host: new StubInsightHost({ permissions: [] }),
        element: (
          <SaveAsInsightAction
            projectId="project-1"
            conversationId="conversation-1"
            messageId="message-1"
            answerText="Checkout errors doubled overnight."
          />
        ),
        answer: (call) => Promise.reject(new Error(`No answer for ${call.path}`)),
      });

      expect(screen.queryByRole("button", { name: "Save as insight" })).not.toBeInTheDocument();
    });
  });
});
