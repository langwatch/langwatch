/**
 * @vitest-environment jsdom
 */
import { renderWithDesignSystem } from "@langwatch/design-system/testing";
import { cleanup, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

import type { BoardPeriodRange } from "../../../model/board-period.ts";
import { BoardPeriodControl } from "../board-period-control.tsx";

afterEach(cleanup);

function openControl({
  range,
  refresh = "5m",
}: {
  range: BoardPeriodRange;
  refresh?: "off" | "1m" | "5m";
}) {
  const onRefreshChange = vi.fn();
  renderWithDesignSystem(
    <BoardPeriodControl
      range={range}
      grain="auto"
      refresh={refresh}
      onRangeChange={vi.fn()}
      onGrainChange={vi.fn()}
      onRefreshChange={onRefreshChange}
    />,
  );
  return { onRefreshChange, user: userEvent.setup({ pointerEventsCheck: 0 }) };
}

const disabled = (item: HTMLElement) => item.getAttribute("aria-disabled") === "true";

describe("given the board period control", () => {
  describe("when the member opens it on a 30-day board", () => {
    /** @scenario "AC19 One control sets the range, the grain and the refresh" */
    it("shows range and grain on the pill, and Range, Grain and Refresh in one menu", async () => {
      const { user, onRefreshChange } = openControl({ range: "30d" });
      const pill = screen.getByRole("button", { name: "Period" });
      expect(pill).toHaveTextContent("30d");
      expect(pill).toHaveTextContent("· auto");

      await user.click(pill);
      for (const column of ["Range", "Grain", "Refresh"]) {
        expect(await screen.findByRole("group", { name: column })).toBeInTheDocument();
      }
      const refresh = within(screen.getByRole("group", { name: "Refresh" }));
      await user.click(refresh.getByRole("menuitem", { name: /^off/ }));
      expect(onRefreshChange).toHaveBeenCalledWith("off");
    });

    /** @scenario "AC19b A grain that does not fit the range cannot be picked" */
    it("greys out 1m and 5m, and offers the coarser grains", async () => {
      const { user } = openControl({ range: "30d" });
      await user.click(screen.getByRole("button", { name: "Period" }));
      const grains = within(await screen.findByRole("group", { name: "Grain" }));
      expect(disabled(grains.getByRole("menuitem", { name: /^1m/ }))).toBe(true);
      expect(disabled(grains.getByRole("menuitem", { name: /^5m/ }))).toBe(true);
      for (const grain of ["auto", "1h", "1d", "1w"]) {
        expect(disabled(grains.getByRole("menuitem", { name: new RegExp(`^${grain}`) }))).toBe(
          false,
        );
      }
    });
  });

  describe("when the board is Live", () => {
    /** @scenario "AC19c Live is the last hour, rolling, refreshed every minute" */
    it("shows Live on the pill, offers 1m, and holds the refresh at every minute", async () => {
      const { user } = openControl({ range: "live", refresh: "1m" });
      const pill = screen.getByRole("button", { name: "Period" });
      expect(pill).toHaveTextContent("Live");
      expect(pill).not.toHaveTextContent("· auto");

      await user.click(pill);
      const grains = within(await screen.findByRole("group", { name: "Grain" }));
      expect(disabled(grains.getByRole("menuitem", { name: /^1m/ }))).toBe(false);
      const refresh = within(screen.getByRole("group", { name: "Refresh" }));
      expect(disabled(refresh.getByRole("menuitem", { name: /^every 1m/ }))).toBe(false);
      expect(disabled(refresh.getByRole("menuitem", { name: /^off/ }))).toBe(true);
      expect(disabled(refresh.getByRole("menuitem", { name: /^every 5m/ }))).toBe(true);
    });
  });
});
