/**
 * @vitest-environment jsdom
 *
 * A value a group in the search bar makes optional says "in group" instead of include or exclude.
 * @see specs/traces-v2/search.feature
 */
import { renderWithDesignSystem } from "@langwatch/design-system/testing";
import type { FacetDisplayState } from "@langwatch/trace-contract";
import { cleanup, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

import { FacetRow } from "../facet-row.tsx";

const renderRow = ({
  state,
  onToggle = vi.fn(),
}: {
  state: FacetDisplayState;
  onToggle?: () => void;
}) =>
  renderWithDesignSystem(
    <FacetRow
      item={{ value: "error", label: "error", count: 5, countState: "settled" }}
      state={state}
      maxCount={12}
      onToggle={onToggle}
      onExclude={vi.fn()}
      field="status"
    />,
  );

const groupedLabelOf = (container: HTMLElement) => container.querySelector("[data-facet-grouped]");

afterEach(() => cleanup());

describe("<FacetRow /> in a group", () => {
  describe("given the row's term is part of a group", () => {
    /** @scenario "A value a group in the search bar makes optional is marked as in group" */
    it.each<FacetDisplayState>(["grouped-include", "grouped-exclude"])(
      "says in group when %s, titled for the search bar, neither checked nor excluded",
      (state) => {
        const { container } = renderRow({ state });
        expect(groupedLabelOf(container)).toHaveTextContent("in group");
        expect(
          container.querySelector('[title="Part of a group in the search bar"]'),
        ).not.toBeNull();
        expect(screen.getByRole("checkbox")).not.toBeChecked();
        expect(screen.getByRole("checkbox")).not.toBePartiallyChecked();
        expect(screen.getByRole("checkbox", { name: "error — in group" })).toBeInTheDocument();
      },
    );

    /** @scenario "The exclude button on a row in a group says what a click does" */
    it("offers to stop excluding a term the query negates, as clicking it does", () => {
      renderRow({ state: "grouped-exclude" });
      const exclude = screen.getByRole("button", { name: "Stop excluding error" });
      expect(exclude).toHaveAttribute("aria-pressed", "true");
    });

    it("offers to exclude a term the query does not negate", () => {
      renderRow({ state: "grouped-include" });
      const exclude = screen.getByRole("button", { name: "Exclude error" });
      expect(exclude).toHaveAttribute("aria-pressed", "false");
    });

    it("still toggles on click", async () => {
      const onToggle = vi.fn();
      renderRow({ state: "grouped-include", onToggle });
      await userEvent.setup().click(screen.getByText("error"));
      expect(onToggle).toHaveBeenCalledWith("error");
    });
  });

  describe("given the row's term is required", () => {
    /** @scenario "Values every result must match keep their include or exclude mark" */
    it.each<FacetDisplayState>(["include", "exclude", "neutral"])(
      "shows no in group label when %s",
      (state) => {
        const { container } = renderRow({ state });
        expect(groupedLabelOf(container)).toBeNull();
      },
    );
  });
});
