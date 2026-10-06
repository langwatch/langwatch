/**
 * @vitest-environment jsdom
 *
 * The toolbar's grouping menu, time-range popover and columns picker.
 * @see specs/traces-v2/trace-table.feature
 */
import { renderWithDesignSystem } from "@langwatch/design-system/testing";
import { cleanup, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useExplorerStore } from "../../../../../behavior/explorer.store.ts";
import { ColumnPickerContent } from "../column-picker-content.tsx";
import { GroupingSelector } from "../grouping-selector.tsx";
import { TimeRangePicker } from "../time-range-picker.tsx";
import "@testing-library/jest-dom/vitest";

vi.mock("../../../../../behavior/use-organization-team-project.ts", () => ({
  useOrganizationTeamProject: () => ({
    project: { id: "proj-1", slug: "acme" },
    hasPermission: () => true,
  }),
}));

vi.mock("../../hooks/use-evaluator-options.ts", () => ({
  useEvaluatorOptions: () => ({ options: [], nameByKey: new Map() }),
}));

beforeEach(() => {
  useExplorerStore.getState().clearAll();
  useExplorerStore.getState().setGrouping("flat");
});

afterEach(() => {
  cleanup();
});

describe("the grouping menu", () => {
  /** @scenario "Grouping selector shows checkmark on selected item" */
  it("marks the selected grouping with a checkmark and no other item", async () => {
    useExplorerStore.getState().setGrouping("by-model");
    renderWithDesignSystem(<GroupingSelector />);

    await userEvent.click(screen.getByRole("button", { name: /Group rows/ }));

    const items = await screen.findAllByRole("menuitemradio");
    const selected = items.filter((item) => item.getAttribute("aria-checked") === "true");
    expect(selected.map((item) => item.textContent)).toEqual(["By Model"]);
    expect(selected[0]?.querySelector("svg")).toBeVisible();
    for (const item of items.filter((i) => i !== selected[0])) {
      expect(item.querySelector("svg")).not.toBeVisible();
    }
  });
});

describe("the time range picker", () => {
  /** @scenario "Time range picker shows relative presets and absolute dates" */
  it("offers relative presets, absolute dates, the timezone and a copy button", async () => {
    renderWithDesignSystem(<TimeRangePicker />);

    await userEvent.click(screen.getByRole("button", { name: /Time range:/ }));

    expect(await screen.findByRole("button", { name: "Last 15 minutes" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Last 1 hour" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Last 24 hours" })).toBeVisible();
    expect(screen.getByText("Absolute range")).toBeVisible();
    expect(screen.getByText("From")).toBeVisible();
    expect(screen.getByText("To")).toBeVisible();
    expect(screen.getByText(/\(UTC[+-]\d{2}:\d{2}\)$/)).toBeVisible();
    expect(screen.getByRole("button", { name: "Copy time range" })).toBeVisible();
  });
});

describe("the columns picker", () => {
  /** @scenario "Columns dropdown shows organized sections" */
  it("lists Standard, Evaluations and Events sections, each column with a checkbox", () => {
    renderWithDesignSystem(<ColumnPickerContent />);

    const sectionBoxes = (title: string) =>
      screen
        .getAllByText(title)
        .map((label) => label.nextElementSibling)
        .filter((list): list is Element => list !== null)
        .flatMap((list) => within(list as HTMLElement).queryAllByRole("checkbox"));

    for (const title of ["Standard", "Evaluations", "Events"]) {
      expect(sectionBoxes(title).length).toBeGreaterThan(0);
    }
    expect(sectionBoxes("Standard").length).toBeGreaterThan(3);
    expect(screen.getByRole("checkbox", { name: /Service/ })).toBeInTheDocument();
  });

  /** @scenario "Toggling a column checkbox shows or hides the column" */
  it("adds the Service column to the view when its checkbox is checked", async () => {
    const store = useExplorerStore.getState();
    if (store.columnOrder.includes("service")) store.toggleColumn("service");
    expect(useExplorerStore.getState().columnOrder).not.toContain("service");
    renderWithDesignSystem(<ColumnPickerContent />);

    await userEvent.click(screen.getByRole("checkbox", { name: /Service/ }));

    expect(useExplorerStore.getState().columnOrder).toContain("service");
  });
});
