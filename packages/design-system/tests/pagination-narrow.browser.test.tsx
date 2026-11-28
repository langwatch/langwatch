/**
 * Measured in real Chromium: on a phone the pagination stacks the summary above a one-line pager
 * that stays clear of the bottom-right corner; on a wide screen it keeps one row with seven pages.
 * @see packages/design-system/specs/pagination-narrow.feature
 */
import { cleanup, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { page } from "vitest/browser";

import { Pagination } from "../src/components/layout/pagination.tsx";
import { renderWithDesignSystem } from "../src/testing/index.tsx";

const PHONE_WIDTH = 390;
/** The floating assistant button: 46px wide, 20px from the right edge. */
const CORNER_CLEARANCE_PX = 66;

afterEach(cleanup);

async function renderTraceFooter({
  width,
  layout = "center",
}: {
  width: number;
  layout?: "center" | "end";
}) {
  await page.viewport(width, 800);
  renderWithDesignSystem(
    <Pagination
      page={1}
      pageSize={50}
      totalCount={1424}
      totalSummary="1,424 traces"
      pageSizeOptions={[25, 50, 100, 250, 500, 1000]}
      layout={layout}
      ground="card"
      summaryTone="subtle"
      onPageChange={() => undefined}
      onPageSizeChange={() => undefined}
    />,
  );
  return {
    bar: await screen.findByTestId("pagination"),
    summary: screen.getByTestId("pagination-indicator"),
    back: screen.getByTestId("pagination-prev"),
    next: screen.getByTestId("pagination-next"),
    pageButtons: screen.queryAllByTestId(/^pagination-page-\d+$/),
  };
}

const rect = (element: Element) => element.getBoundingClientRect();

describe("pagination on a phone-width screen", () => {
  /** @scenario "Pagination fits a phone-width screen on one line under its summary" */
  it.each(["center", "end"] as const)(
    "stacks the summary above a one-line pager clear of the bottom-right corner (%s layout)",
    async (layout) => {
      const { bar, summary, back, next, pageButtons } = await renderTraceFooter({
        width: PHONE_WIDTH,
        layout,
      });

      expect(rect(summary).bottom).toBeLessThanOrEqual(rect(back).top);
      expect(Math.abs(rect(back).top - rect(next).top)).toBeLessThan(2);
      for (const button of pageButtons) {
        expect(Math.abs(rect(button).top - rect(back).top)).toBeLessThan(2);
      }
      expect(pageButtons.map((button) => button.textContent)).toEqual(["1", "2", "3", "29"]);
      expect(rect(next).right).toBeLessThanOrEqual(PHONE_WIDTH - CORNER_CLEARANCE_PX);
      expect(bar.scrollWidth).toBeLessThanOrEqual(bar.clientWidth);
    },
  );
});

describe("pagination on a wide screen", () => {
  /** @scenario "Pagination keeps one row with neighbouring pages on a wide screen" */
  it("keeps the summary and the pager on one row with two neighbours each side", async () => {
    const { summary, back, pageButtons } = await renderTraceFooter({ width: 1400 });

    expect(Math.abs(rect(summary).top - rect(back).top)).toBeLessThan(12);
    expect(rect(back).left).toBeGreaterThan(rect(summary).right);
    expect(pageButtons.map((button) => button.textContent)).toEqual([
      "1",
      "2",
      "3",
      "4",
      "5",
      "6",
      "7",
      "29",
    ]);
  });
});
