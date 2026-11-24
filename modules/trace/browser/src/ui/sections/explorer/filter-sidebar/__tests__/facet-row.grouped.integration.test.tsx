/**
 * @vitest-environment jsdom
 *
 * A value a group in the search bar makes optional says "in group" instead of include or exclude.
 * @see specs/traces-v2/search.feature
 */
import { renderWithDesignSystem } from "@langwatch/design-system/testing";
import { cleanup, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

import type { FacetValueState } from "../../../../../behavior/explorer/filter-sidebar/types.ts";
import { FacetRow } from "../facet-row.tsx";

const renderRow = ({
  state,
  onToggle = vi.fn(),
}: {
  state: FacetValueState;
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
    it("says in group, titled for the search bar, and is neither checked nor excluded", () => {
      const { container } = renderRow({ state: "grouped" });
      expect(groupedLabelOf(container)).toHaveTextContent("in group");
      expect(container.querySelector('[title="Part of a group in the search bar"]')).not.toBeNull();
      expect(screen.getByRole("checkbox")).not.toBeChecked();
      expect(screen.getByRole("checkbox")).not.toBePartiallyChecked();
    });

    it("still toggles on click", async () => {
      const onToggle = vi.fn();
      renderRow({ state: "grouped", onToggle });
      await userEvent.setup().click(screen.getByText("error"));
      expect(onToggle).toHaveBeenCalledWith("error");
    });
  });

  describe("given the row's term is required", () => {
    /** @scenario "Values every result must match keep their include or exclude mark" */
    it.each<FacetValueState>(["include", "exclude", "neutral"])(
      "shows no in group label when %s",
      (state) => {
        const { container } = renderRow({ state });
        expect(groupedLabelOf(container)).toBeNull();
      },
    );
  });
});
