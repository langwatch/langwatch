/**
 * @vitest-environment jsdom
 * The topbar bell over the real tRPC hooks: what it lists and where it leads.
 * @see modules/insight/specs/insight-inbox.feature
 */

import { nowInstant } from "@langwatch/time";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { insightEntry, renderWithInsightHost } from "../../../testing.tsx";
import { InsightsBell } from "../insights-bell.tsx";

const HOUR_MS = 3_600_000;
const NOW = nowInstant().epochMilliseconds;

/** Five unseen insights, "Insight 1" the newest and "Insight 5" the oldest. */
const UNSEEN = [1, 2, 3, 4, 5].map((position) =>
  insightEntry({
    id: `insight-${position}`,
    title: `Insight ${position}`,
    filedAt: NOW - position * HOUR_MS,
  }),
);

describe("given 5 unseen insights in the inbox", () => {
  describe("when a member opens the bell in the top bar", () => {
    /** @scenario "The bell lists new insights" */
    it("shows the 4 newest and a link that opens the inbox", async () => {
      const { host } = renderWithInsightHost({
        element: <InsightsBell />,
        // Oldest first on the wire, so the order shown is the bell's own.
        answer: () => Promise.resolve(UNSEEN.toReversed()),
      });
      expect(await screen.findByLabelText("5 unread")).toBeInTheDocument();

      await userEvent.click(screen.getByRole("button", { name: "Inbox: new insights" }));

      expect(await screen.findByText("Insight 1")).toBeInTheDocument();
      expect(screen.getAllByText(/^Insight \d$/).map((title) => title.textContent)).toEqual([
        "Insight 1",
        "Insight 2",
        "Insight 3",
        "Insight 4",
      ]);

      await userEvent.click(screen.getByRole("button", { name: "Open inbox" }));

      expect(host.navigations).toEqual(["/acme/insights"]);
    });
  });
});
