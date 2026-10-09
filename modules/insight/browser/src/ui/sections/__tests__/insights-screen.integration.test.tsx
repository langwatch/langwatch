/**
 * @vitest-environment jsdom
 * The Insights page over the real tRPC hooks: what a project with no insights is told, and
 * what a folder visit sends.
 * @see modules/insight/specs/insight-inbox.feature
 */

import type { UiProcedureCall } from "@langwatch/browser/testing-transport";
import { nowInstant } from "@langwatch/time";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { insightEntry, renderWithInsightHost } from "../../../testing.tsx";
import InsightsScreen from "../insights.screen.tsx";

const HOUR_MS = 3_600_000;
const NOW = nowInstant().epochMilliseconds;

/** Answers the inbox read and acknowledges a seen write, keeping every call for the test. */
function project({ entries }: { entries: ReturnType<typeof insightEntry>[] }) {
  const calls: UiProcedureCall[] = [];
  const answer = (call: UiProcedureCall) => {
    calls.push(call);
    if (call.path === "insights.getAll") return Promise.resolve(entries);
    if (call.path === "insights.markSeen") return Promise.resolve(null);
    return Promise.reject(new Error(`No test answer for ${call.path}`));
  };
  return { answer, seenWrites: () => calls.filter((call) => call.path === "insights.markSeen") };
}

describe("given a project with no insights", () => {
  describe("when a member opens Insights", () => {
    /** @scenario "A project with no insights shows how to get the first one" */
    it("says Langy writes the brief here and offers an action that opens Langy", async () => {
      const { host } = renderWithInsightHost({
        element: <InsightsScreen />,
        answer: project({ entries: [] }).answer,
      });

      expect(await screen.findByText("Langy writes your brief here")).toBeInTheDocument();

      await userEvent.click(screen.getByRole("button", { name: "Open Langy" }));

      expect(host.langyAsks).toEqual([{ draft: "" }]);
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
