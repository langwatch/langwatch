/**
 * @vitest-environment jsdom
 * "Save as insight" under a Langy answer: who may save, what the filing carries of the board,
 * the widget and the query the answer was about, and what the saver is told.
 * @see modules/insight/specs/insight-inbox.feature
 */

import type { UiProcedureCall } from "@langwatch/browser/testing-transport";
import type { LangyAnswerSubject } from "@langwatch/langy-contract";
import { cleanup, screen, waitFor } from "@testing-library/react";
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

afterEach(cleanup);

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
    /** @scenario "Saving a Langy answer about a board passes the pointer and the window" */
    it("files it with no pointer, no query and no window", async () => {
      const { filed } = await saveAnswer({});

      expect(filed).toMatchObject({ projectId: "project-1" });
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
