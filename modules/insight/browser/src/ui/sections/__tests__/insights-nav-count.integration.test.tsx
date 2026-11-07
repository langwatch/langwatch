/**
 * @vitest-environment jsdom
 * The sidebar's unread pill over the real tRPC hooks: a plain count, never a verdict.
 * @see modules/insight/specs/insight-inbox.feature
 */

import type { InsightTone } from "@langwatch/insight-contract";
import { cleanup, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { insightEntry, renderWithInsightHost } from "../../../testing.tsx";
import { InsightsNavCount } from "../insights-nav-count.tsx";

async function pillOver(tones: readonly InsightTone[]): Promise<HTMLElement> {
  const unseen = tones.map((tone, index) => insightEntry({ id: `insight-${index}`, tone }));
  renderWithInsightHost({
    element: <InsightsNavCount />,
    answer: () => Promise.resolve(unseen),
  });
  return screen.findByLabelText(`${tones.length} unread`);
}

afterEach(cleanup);

describe("given unseen insights in the inbox", () => {
  describe("when the sidebar draws the unread pill", () => {
    /** @scenario "The unread pill is a plain count in one neutral colour" */
    it("shows only the count, drawn the same way whatever the verdicts", async () => {
      const urgent = await pillOver(["bad", "watch"]);
      const urgentStyle = urgent.className;
      expect(urgent).toHaveTextContent(/^2$/);
      cleanup();

      const calm = await pillOver(["good", "good"]);

      expect(calm).toHaveTextContent(/^2$/);
      expect(calm.className).toBe(urgentStyle);
    });
  });
});
