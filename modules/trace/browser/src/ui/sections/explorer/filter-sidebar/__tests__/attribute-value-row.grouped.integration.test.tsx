/**
 * @vitest-environment jsdom
 *
 * An attribute value a group in the search bar makes optional says "in group", like a value row.
 * @see specs/traces-v2/search.feature
 */
import { renderWithDesignSystem } from "@langwatch/design-system/testing";
import type { FacetDisplayState } from "@langwatch/trace-contract";
import { cleanup, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

import { AttributeValueRow } from "../attribute-value-row.tsx";

const renderRow = (state: FacetDisplayState, onToggle = vi.fn()) =>
  renderWithDesignSystem(
    <AttributeValueRow attrKey="customer" value="a" label="a" state={state} onToggle={onToggle} />,
  );

const groupedLabelOf = (container: HTMLElement) => container.querySelector("[data-facet-grouped]");

afterEach(() => cleanup());

describe("<AttributeValueRow /> in a group", () => {
  describe("given the attribute term is part of a group", () => {
    /** @scenario "Attribute and event rows a group makes optional also say in group" */
    it.each<FacetDisplayState>(["grouped-include", "grouped-exclude"])(
      "says in group when %s, neither checked nor struck out",
      (state) => {
        const { container } = renderRow(state);
        expect(groupedLabelOf(container)).toHaveTextContent("in group");
        expect(
          container.querySelector('[title="Part of a group in the search bar"]'),
        ).not.toBeNull();
        expect(screen.getByRole("checkbox")).not.toBeChecked();
        expect(screen.getByRole("checkbox")).not.toBePartiallyChecked();
        expect(screen.getByText("a")).not.toHaveStyle({ textDecoration: "line-through" });
      },
    );
  });

  describe("when a grouped attribute row is clicked", () => {
    it("toggles that attribute value as before", async () => {
      const onToggle = vi.fn();
      renderRow("grouped-exclude", onToggle);
      await userEvent.setup().click(screen.getByText("a"));
      expect(onToggle).toHaveBeenCalledWith("customer", "a");
    });
  });

  describe("given the attribute term is required", () => {
    it.each<FacetDisplayState>(["include", "exclude", "neutral"])(
      "shows no in group label when %s",
      (state) => {
        const { container } = renderRow(state);
        expect(groupedLabelOf(container)).toBeNull();
      },
    );
  });
});
