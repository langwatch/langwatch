/**
 * @vitest-environment jsdom
 *
 * A value a group in the search bar makes optional says "in group" and what a click does.
 * @see specs/traces-v2/search.feature
 */
import { renderWithDesignSystem } from "@langwatch/design-system/testing";
import {
  buildFacetDisplayLookup,
  excludedFacetQuery,
  type FacetDisplayState,
  parse,
} from "@langwatch/trace-contract";
import { cleanup, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

import { FacetRow } from "../facet-row.tsx";

const renderRow = ({
  state,
  value = "error",
  label = "Error",
  field = "status",
  onToggle = vi.fn(),
  onExclude = vi.fn(),
}: {
  state: FacetDisplayState;
  value?: string;
  label?: string;
  field?: string;
  onToggle?: (value: string) => void;
  onExclude?: (value: string) => void;
}) =>
  renderWithDesignSystem(
    <FacetRow
      item={{ value, label, count: 5, countState: "settled" }}
      state={state}
      maxCount={12}
      onToggle={onToggle}
      onExclude={onExclude}
      field={field}
    />,
  );

const groupedLabelOf = (container: HTMLElement) => container.querySelector("[data-facet-grouped]");
const displayStateIn = ({ query, field, value }: { query: string; field: string; value: string }) =>
  buildFacetDisplayLookup(parse(query)).get(`${field}|${value}`) ?? "neutral";

afterEach(() => cleanup());

describe("<FacetRow /> in a group", () => {
  describe("given the row's term is part of a group", () => {
    /** @scenario "A value a group in the search bar makes optional is marked as in group" */
    it.each<[FacetDisplayState, string]>([
      ["grouped-include", "exclude"],
      ["grouped-exclude", "remove from the group"],
    ])(
      "says in group when %s, titled and named with what a click does (%s), neither checked nor excluded",
      (state, action) => {
        const { container } = renderRow({ state });
        expect(groupedLabelOf(container)).toHaveTextContent("in group");
        expect(
          container.querySelector(
            `[title="Part of a group in the search bar. Click to ${action}."]`,
          ),
        ).not.toBeNull();
        const row = screen.getByRole("checkbox", { name: `Error — in group, click to ${action}` });
        expect(row).not.toBeChecked();
        expect(row).not.toBePartiallyChecked();
      },
    );

    /** @scenario "The exclude button on a row in a group says what a click does" */
    it("offers to remove a term the query negates from the group, not as a pressed toggle", () => {
      renderRow({ state: "grouped-exclude" });
      const button = screen.getByRole("button", { name: "Remove Error from the group" });
      expect(button).not.toHaveAttribute("aria-pressed");
    });

    it("offers to exclude a term the query names plainly", () => {
      renderRow({ state: "grouped-include" });
      const button = screen.getByRole("button", { name: "Exclude Error" });
      expect(button).toHaveAttribute("aria-pressed", "false");
    });

    it("still toggles on click", async () => {
      const onToggle = vi.fn();
      renderRow({ state: "grouped-include", onToggle });
      await userEvent.setup().click(screen.getByText("Error"));
      expect(onToggle).toHaveBeenCalledWith("error");
    });
  });

  describe("when the exclude button of a grouped row is clicked", () => {
    /** @scenario "The exclude button on a row in a group says what a click does" */
    it.each([
      ["NOT (status:error AND model:x)", "status", "error", "Error"],
      ["NOT (evaluator:abc AND evaluatorVerdict:fail)", "evaluator", "abc", "abc"],
      ["status:error AND NOT (status:error AND model:x)", "model", "x", "x"],
      ["NOT ((status:error OR model:x) AND user:u1)", "status", "error", "Error"],
      ["-status:error OR NOT model:x", "status", "error", "Error"],
    ])(
      "in %s it reads remove %s:%s from the group, and the click does that",
      async (query, field, value, label) => {
        const onExclude = vi.fn();
        renderRow({
          state: displayStateIn({ query, field, value }),
          field,
          value,
          label,
          onExclude,
        });
        await userEvent
          .setup()
          .click(screen.getByRole("button", { name: `Remove ${label} from the group` }));
        expect(onExclude).toHaveBeenCalledWith(value);
        const next = excludedFacetQuery({ queryText: query, field, value });
        expect(displayStateIn({ query: next, field, value })).toBe("neutral");
      },
    );

    it.each([
      ["status:error OR model:x", "status", "error", "Error"],
      ["(status:error AND user:u1) OR model:x", "status", "error", "Error"],
      ["NOT status:error AND (status:error OR model:x)", "status", "error", "Error"],
      ["NOT status:error OR (status:error AND model:x)", "status", "error", "Error"],
    ])(
      "in %s it reads exclude %s:%s, and the click excludes it from every result",
      async (query, field, value, label) => {
        const onExclude = vi.fn();
        renderRow({
          state: displayStateIn({ query, field, value }),
          field,
          value,
          label,
          onExclude,
        });
        await userEvent.setup().click(screen.getByRole("button", { name: `Exclude ${label}` }));
        expect(onExclude).toHaveBeenCalledWith(value);
        const next = excludedFacetQuery({ queryText: query, field, value });
        expect(displayStateIn({ query: next, field, value })).toBe("exclude");
      },
    );
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

    it("keeps the pressed stop-excluding button on an excluded row", () => {
      renderRow({ state: "exclude" });
      const button = screen.getByRole("button", { name: "Stop excluding Error" });
      expect(button).toHaveAttribute("aria-pressed", "true");
    });
  });
});
