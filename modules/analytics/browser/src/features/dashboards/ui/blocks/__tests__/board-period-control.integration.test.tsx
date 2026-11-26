/**
 * @vitest-environment jsdom
 */
import { renderWithDesignSystem } from "@langwatch/design-system/testing";
import { cleanup, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

import {
  type BoardCustomWindow,
  boardPeriodBounds,
  type BoardPeriodGrain,
  type BoardPeriodPreset,
} from "../../../model/board-period.ts";
import { BoardPeriodControl } from "../board-period-control.tsx";

afterEach(cleanup);

const NOW = Date.UTC(2026, 10, 25, 12);

function openControl({
  range,
  grain = "auto",
  refresh = "5m",
  custom,
  refreshApplies = true,
}: {
  range: BoardPeriodPreset | "custom";
  grain?: BoardPeriodGrain;
  refresh?: "off" | "1m" | "5m";
  custom?: BoardCustomWindow;
  refreshApplies?: boolean;
}) {
  const onRefreshChange = vi.fn();
  const onRefreshNow = vi.fn();
  const onCustomChange = vi.fn();
  const period = custom
    ? { periodStart: custom.from, periodEnd: custom.to }
    : boardPeriodBounds({ range: range === "custom" ? "30d" : range, now: NOW });
  renderWithDesignSystem(
    <BoardPeriodControl
      range={range}
      grain={grain}
      custom={custom}
      period={{ ...period, granularitySeconds: 86_400 }}
      refresh={refresh}
      refreshApplies={refreshApplies}
      onRangeChange={vi.fn()}
      onCustomChange={onCustomChange}
      onGrainChange={vi.fn()}
      onRefreshChange={onRefreshChange}
      onRefreshNow={onRefreshNow}
    />,
  );
  return {
    onRefreshChange,
    onRefreshNow,
    onCustomChange,
    user: userEvent.setup({ pointerEventsCheck: 0 }),
  };
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
      expect(screen.getByRole("button", { name: "Period" }).textContent).toMatch(/^30d\s*· 1d$/);
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

describe("when the member picks Custom under Range", () => {
  /** @scenario "AC19e A custom range reads a fixed window from a start to an end" */
  it("opens the start and end fields and applies the window they hold", async () => {
    const { user, onCustomChange } = openControl({ range: "30d" });
    await user.click(screen.getByRole("button", { name: "Period" }));
    const ranges = within(await screen.findByRole("group", { name: "Range" }));
    await user.click(ranges.getByRole("menuitem", { name: /^Custom/ }));

    const start = await screen.findByLabelText("Start date");
    const end = screen.getByLabelText("End date");
    await user.clear(start);
    await user.type(start, "2026-11-04T09:00");
    await user.clear(end);
    await user.type(end, "2026-11-11T17:30");
    await user.click(screen.getByRole("button", { name: "Apply" }));

    expect(onCustomChange).toHaveBeenCalledWith({
      from: new Date(2026, 10, 4, 9, 0).getTime(),
      to: new Date(2026, 10, 11, 17, 30).getTime(),
    });
  });

  /** @scenario "AC19e A custom range reads a fixed window from a start to an end" */
  it("will not apply an end before the start", async () => {
    const { user, onCustomChange } = openControl({ range: "30d" });
    await user.click(screen.getByRole("button", { name: "Period" }));
    await user.click(await screen.findByRole("menuitem", { name: /^Custom/ }));

    const end = await screen.findByLabelText("End date");
    await user.clear(end);
    await user.type(end, "2020-01-01T00:00");

    expect(screen.getByRole("button", { name: "Apply" })).toBeDisabled();
    expect(screen.getByText("The start must come before the end.")).toBeInTheDocument();
    expect(onCustomChange).not.toHaveBeenCalled();
  });
});

describe("when the board reads a custom range", () => {
  const custom = {
    from: new Date(2026, 10, 4, 9, 0).getTime(),
    to: new Date(2026, 10, 11, 17, 30).getTime(),
  };

  /** @scenario "AC19e A custom range reads a fixed window from a start to an end" */
  it("shows the first and last day on the pill and greys out grains it cannot carry", async () => {
    const { user } = openControl({ range: "custom", custom });
    const pill = screen.getByRole("button", { name: "Period" });
    expect(pill).toHaveTextContent("4 Nov - 11 Nov");

    await user.click(pill);
    const grains = within(await screen.findByRole("group", { name: "Grain" }));
    expect(disabled(grains.getByRole("menuitem", { name: /^1m/ }))).toBe(true);
    expect(disabled(grains.getByRole("menuitem", { name: /^1h/ }))).toBe(false);
    const ranges = within(screen.getByRole("group", { name: "Range" }));
    const customItem = ranges.getByRole("menuitem", { name: /^Custom/ });
    expect(within(customItem).getByLabelText("selected")).toBeInTheDocument();
  });

  /** @scenario "AC19f Refresh does not apply to a custom range that has ended" */
  it("greys out every refresh with a note once it has ended, and keeps Refresh now", async () => {
    const { user, onRefreshNow } = openControl({
      range: "custom",
      custom,
      refresh: "off",
      refreshApplies: false,
    });
    await user.click(screen.getByRole("button", { name: "Period" }));
    const refresh = within(await screen.findByRole("group", { name: "Refresh" }));
    for (const option of [/^off/, /^every 1m/, /^every 5m/]) {
      expect(disabled(refresh.getByRole("menuitem", { name: option }))).toBe(true);
    }
    expect(refresh.getByText("Only applies when the range ends now")).toBeInTheDocument();

    await user.click(screen.getByRole("menuitem", { name: "Refresh now" }));
    expect(onRefreshNow).toHaveBeenCalledOnce();
  });
});
