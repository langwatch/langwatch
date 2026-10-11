/**
 * @vitest-environment jsdom
 *
 * The toolbar's grouping select, density toggle, time-range popover and columns picker.
 * @see specs/traces-v2/trace-table.feature
 */
import { renderWithDesignSystem } from "@langwatch/design-system/testing";
import { cleanup, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useExplorerStore } from "../../../../../behavior/explorer.store.ts";
import { useDensityStore } from "../../../../../features/explorer/behavior/density.store.ts";
import { ColumnPickerContent } from "../column-picker-content.tsx";
import { DensityToggle } from "../density-toggle.tsx";
import { GroupingSelect } from "../grouping-select.tsx";
import { TimeRangePicker } from "../time-range-picker.tsx";
import "@testing-library/jest-dom/vitest";

vi.mock("../../../../../behavior/trace-host.ts", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useTraceHost: () => ({ hasPermission: () => true }),
}));
const scope = vi.hoisted(() => ({ isPersonal: false }));
vi.mock("../../../../../behavior/use-organization-team-project.ts", () => ({
  useOrganizationTeamProject: () => ({
    project: { id: "proj-1", slug: "acme" },
    team: { id: "team-1", isPersonal: scope.isPersonal },
  }),
}));

vi.mock("../../../../../features/instant-eval/behavior/use-evaluator-options.ts", () => ({
  useEvaluatorOptions: () => ({ options: [], nameByKey: new Map() }),
}));

beforeEach(() => {
  scope.isPersonal = false;
  useExplorerStore.getState().clearAll();
  useExplorerStore.getState().setGrouping("flat");
});

afterEach(() => {
  cleanup();
});

describe("the grouping select", () => {
  /** @scenario "Grouping selector shows checkmark on selected item" */
  it("marks the selected grouping with a checkmark and no other grouping", async () => {
    useExplorerStore.getState().setGrouping("by-model");
    renderWithDesignSystem(<GroupingSelect />);

    await userEvent.click(screen.getByRole("button", { name: "Group by: Model" }));

    const items = await screen.findAllByRole("menuitemradio");
    const selected = items.filter((item) => item.getAttribute("aria-checked") === "true");
    expect(selected.map((item) => item.textContent)).toEqual(["Model"]);
    expect(selected[0]?.querySelector("svg")).toBeVisible();
    for (const item of items.filter((i) => i !== selected[0])) {
      expect(item.querySelector("svg")).not.toBeVisible();
    }
  });

  it("names the active grouping on the trigger", () => {
    renderWithDesignSystem(<GroupingSelect />);

    const trigger = screen.getByRole("button", { name: "Group by: None" });
    expect(trigger).toHaveTextContent("Group by:None");
  });
});

describe("the grouping select in a coding-agent scope", () => {
  /** @scenario "A coding-agent scope labels the conversation grouping By session" */
  it("reads Session for the conversation grouping, and Conversation elsewhere", async () => {
    useExplorerStore.getState().setGrouping("by-conversation");
    scope.isPersonal = true;
    renderWithDesignSystem(<GroupingSelect />);

    await userEvent.click(screen.getByRole("button", { name: "Group by: Session" }));

    const labels = (await screen.findAllByRole("menuitemradio")).map((item) => item.textContent);
    expect(labels).toContain("Session");
    expect(labels).not.toContain("Conversation");

    cleanup();
    scope.isPersonal = false;
    renderWithDesignSystem(<GroupingSelect />);
    expect(screen.getByRole("button", { name: "Group by: Conversation" })).toBeInTheDocument();
  });
});

describe("the density toggle", () => {
  /** @scenario "Density toggle shows both densities at once" */
  it("labels both densities and switches with one click", async () => {
    useDensityStore.getState().setDensity("comfortable");
    renderWithDesignSystem(<DensityToggle />);

    const compact = screen.getByRole("radio", { name: "Compact" });
    expect(screen.getByRole("radio", { name: "Comfortable" })).toBeChecked();
    expect(screen.getByText("Compact")).toBeVisible();
    expect(screen.getByText("Comfortable")).toBeVisible();

    await userEvent.click(compact);

    expect(useDensityStore.getState().density).toBe("compact");
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

  /** @scenario "The session id column can be added and shows the id" */
  it("offers Session ID and adds it to the view when its checkbox is checked", async () => {
    const store = useExplorerStore.getState();
    if (store.columnOrder.includes("sessionId")) store.toggleColumn("sessionId");
    renderWithDesignSystem(<ColumnPickerContent />);

    await userEvent.click(screen.getByRole("checkbox", { name: /Session ID/ }));

    expect(useExplorerStore.getState().columnOrder).toContain("sessionId");
  });
});
