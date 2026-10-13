/**
 * @vitest-environment jsdom
 */
import { renderWithDesignSystem } from "@langwatch/design-system/testing";
import { cleanup, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

import type { BoardPeriodGrain, BoardPeriodRange } from "../../../model/board-period.ts";
import { BoardPeriodControl } from "../board-period-control.tsx";

afterEach(cleanup);

function openControl({
  range,
  grain = "auto",
  refresh = "5m",
}: {
  range: BoardPeriodRange;
  grain?: BoardPeriodGrain;
  refresh?: "off" | "1m" | "5m";
}) {
  const onRefreshChange = vi.fn();
  const onRefreshNow = vi.fn();
  renderWithDesignSystem(
    <BoardPeriodControl
      range={range}
      grain={grain}
      refresh={refresh}
      onRangeChange={vi.fn()}
      onGrainChange={vi.fn()}
      onRefreshChange={onRefreshChange}
      onRefreshNow={onRefreshNow}
    />,
  );
  return { onRefreshChange, onRefreshNow, user: userEvent.setup({ pointerEventsCheck: 0 }) };
}

const disabled = (item: HTMLElement) => item.getAttribute("aria-disabled") === "true";

describe("given the board period control", () => {
  describe("when the member opens it on a 30-day board", () => {
    /** @scenario "AC19 One control sets the range, the grain and the refresh" */
    it("shows the range on the pill, and Range, Grain and Refresh in one menu", async () => {
      const { user, onRefreshChange } = openControl({ range: "30d" });
      const pill = screen.getByRole("button", { name: "Period" });
      expect(pill).toHaveTextContent("30d");
      expect(pill).not.toHaveTextContent("auto");
      expect(pill).not.toHaveTextContent("5m");
      expect(within(pill).queryByLabelText("auto-refresh")).toBeNull();

      await user.click(pill);
      for (const column of ["Range", "Grain", "Refresh"]) {
        expect(await screen.findByRole("group", { name: column })).toBeInTheDocument();
      }
      const refresh = within(screen.getByRole("group", { name: "Refresh" }));
      await user.click(refresh.getByRole("menuitem", { name: /^off/ }));
      expect(onRefreshChange).toHaveBeenCalledWith("off");
    });

    /** @scenario "AC19 One control sets the range, the grain and the refresh" */
    it("names a grain the member picked on the pill", () => {
      openControl({ range: "30d", grain: "1d" });
      expect(screen.getByRole("button", { name: "Period" })).toHaveTextContent(/30d\s*· 1d/);
    });

    /** @scenario "AC7 Refresh sits inside the period menu" */
    it("re-runs every widget from Refresh now inside the menu", async () => {
      const { user, onRefreshNow } = openControl({ range: "30d" });
      await user.click(screen.getByRole("button", { name: "Period" }));
      await user.click(await screen.findByRole("menuitem", { name: "Refresh now" }));
      expect(onRefreshNow).toHaveBeenCalledOnce();
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
