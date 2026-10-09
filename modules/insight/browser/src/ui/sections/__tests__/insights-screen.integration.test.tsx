/**
 * @vitest-environment jsdom
 * The Insights page over the real tRPC hooks: what a project with no insights is told, whose
 * the page says the insights are, what a folder visit sends and what Copy writes.
 * @see modules/insight/specs/insight-inbox.feature
 */

import type { UiProcedureCall } from "@langwatch/browser/testing-transport";
import { nowInstant } from "@langwatch/time";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { insightEntry, renderWithInsightHost, StubInsightHost } from "../../../testing.tsx";
import InsightsScreen from "../insights.screen.tsx";

const HOUR_MS = 3_600_000;
const NOW = nowInstant().epochMilliseconds;

/** Answers the inbox read and acknowledges the reader's writes, keeping every call for the test. */
function project({ entries }: { entries: ReturnType<typeof insightEntry>[] }) {
  const calls: UiProcedureCall[] = [];
  const answer = (call: UiProcedureCall) => {
    calls.push(call);
    if (call.path === "insights.getAll") return Promise.resolve(entries);
    if (call.path === "insights.markSeen") return Promise.resolve(null);
    if (call.path === "insights.keep") return Promise.resolve(null);
    return Promise.reject(new Error(`No test answer for ${call.path}`));
  };
  const writesTo = (path: string) => calls.filter((call) => call.path === path);
  return {
    answer,
    seenWrites: () => writesTo("insights.markSeen"),
    keepWrites: () => writesTo("insights.keep"),
  };
}

describe("given a project with no insights", () => {
  describe("when a member opens Insights", () => {
    /** @scenario "A project with no insights shows how to get the first one" */
    it("says Langy writes the brief here, for them alone, and offers an action that opens Langy", async () => {
      const { host } = renderWithInsightHost({
        element: <InsightsScreen />,
        answer: project({ entries: [] }).answer,
      });

      expect(await screen.findByText("Langy writes your brief here")).toBeInTheDocument();
      expect(screen.getByText(/It is yours alone; copy one to share it\./)).toBeInTheDocument();

      await userEvent.click(screen.getByRole("button", { name: "Open Langy" }));

      expect(host.langyAsks).toEqual([{ draft: "" }]);
    });
  });
});

describe("given a member opens Insights", () => {
  describe("when the page draws", () => {
    /** @scenario "The page says only you see your insights" */
    it("reads that only they see their insights", async () => {
      renderWithInsightHost({
        element: <InsightsScreen />,
        answer: project({ entries: [insightEntry({ seenAt: NOW })] }).answer,
      });

      expect(await screen.findByText("Only you see your insights.")).toBeInTheDocument();
    });
  });
});

describe("given an insight in the inbox", () => {
  const entry = insightEntry({
    title: "Checkout errors doubled",
    body: "Checkout errors doubled overnight: 240 failed against 118 the day before.",
    board: { id: "board-1", name: "Checkout health", widget: null },
    seenAt: NOW,
  });

  describe("when the reader chooses Copy", () => {
    /** @scenario "Copy puts the insight on the clipboard and says so" */
    it("writes its plain text to the clipboard and says it was copied", async () => {
      const { host } = renderWithInsightHost({
        element: <InsightsScreen />,
        answer: project({ entries: [entry] }).answer,
      });

      await userEvent.click(await screen.findByRole("button", { name: "Copy" }));

      await waitFor(() =>
        expect(host.successes).toEqual([{ title: "Copied. Paste it anywhere." }]),
      );
      expect(host.clipboard).toEqual([
        "Checkout errors doubled\n\n" +
          "Checkout errors doubled overnight: 240 failed against 118 the day before.\n\n" +
          "From: Checkout health",
      ]);
    });
  });

  describe("when the browser refuses the clipboard", () => {
    /** @scenario "A clipboard that refuses says the copy failed" */
    it("says the insight could not be copied, and confirms nothing", async () => {
      const { host } = renderWithInsightHost({
        element: <InsightsScreen />,
        answer: project({ entries: [entry] }).answer,
        host: new StubInsightHost({ clipboardRefuses: true }),
      });

      await userEvent.click(await screen.findByRole("button", { name: "Copy" }));

      await waitFor(() =>
        expect(host.failures.map((failure) => failure.fallbackTitle)).toEqual([
          "Couldn't copy this insight",
        ]),
      );
      expect(host.successes).toEqual([]);
    });
  });
});

describe("given 2 unseen insights in the inbox", () => {
  describe("when the reader opens the Inbox folder, leaves it and comes back", () => {
    /** @scenario "Opening a folder marks what it shows as seen, once" */
    it("sends one seen write naming both, and none on the second visit", async () => {
      const { answer, seenWrites } = project({
        entries: [
          insightEntry({ id: "insight-1", title: "Checkout errors doubled", filedAt: NOW }),
          insightEntry({
            id: "insight-2",
            title: "Refund latency is back to normal",
            filedAt: NOW - HOUR_MS,
          }),
        ],
      });
      renderWithInsightHost({ element: <InsightsScreen />, answer });
      const folders = within(await screen.findByRole("navigation", { name: "Insight folders" }));

      await waitFor(() => expect(seenWrites()).toHaveLength(1));
      expect(seenWrites()[0]?.input).toEqual({
        projectId: "project-1",
        insightIds: ["insight-1", "insight-2"],
      });

      await userEvent.click(folders.getByRole("button", { name: /Stale/ }));
      expect(await screen.findByText(/Nothing stale/)).toBeInTheDocument();
      await userEvent.click(folders.getByRole("button", { name: /Inbox/ }));
      expect(await screen.findByText("Checkout errors doubled")).toBeInTheDocument();

      expect(seenWrites()).toHaveLength(1);
    });
  });
});

describe("given an insight the reader marked done", () => {
  describe("when the reader opens the Archived folder and chooses Restore", () => {
    /** @scenario "An archived insight offers Restore" */
    it("keeps the insight for that reader and shows it in the Inbox folder again", async () => {
      const { answer, keepWrites } = project({
        entries: [
          insightEntry({
            id: "insight-1",
            title: "Checkout errors doubled",
            seenAt: NOW - HOUR_MS,
            archivedAt: NOW - HOUR_MS,
          }),
        ],
      });
      renderWithInsightHost({ element: <InsightsScreen />, answer });
      const folders = within(await screen.findByRole("navigation", { name: "Insight folders" }));
      await userEvent.click(folders.getByRole("button", { name: /Archived/ }));

      await userEvent.click(await screen.findByRole("button", { name: "Restore" }));

      await waitFor(() => expect(keepWrites()).toHaveLength(1));
      expect(keepWrites()[0]?.input).toEqual({ projectId: "project-1", insightId: "insight-1" });
      expect(await screen.findByText(/Nothing archived yet/)).toBeInTheDocument();
      await userEvent.click(folders.getByRole("button", { name: /Inbox/ }));
      expect(await screen.findByText("Checkout errors doubled")).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Restore" })).not.toBeInTheDocument();
    });
  });
});
