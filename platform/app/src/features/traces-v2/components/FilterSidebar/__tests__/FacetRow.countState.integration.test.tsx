/**
 * @vitest-environment jsdom
 *
 * A facet row shows a count only when it is the count for the active filter.
 * Until the filtered read lands the row carries no number at all, and while
 * a newer read is in flight the previous number is muted. See
 * specs/traces-v2/search.feature ("Numbers that agree").
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

import { FacetRow } from "../FacetRow";
import type { FacetItem } from "../types";

const renderRow = (item: FacetItem) =>
  render(
    <ChakraProvider value={defaultSystem}>
      <FacetRow
        item={item}
        state="neutral"
        maxCount={12}
        onToggle={vi.fn()}
        onExclude={vi.fn()}
        field="status"
      />
    </ChakraProvider>,
  );

const countOf = (container: HTMLElement) =>
  container.querySelector("[data-facet-count]");

afterEach(() => cleanup());

describe("<FacetRow /> count state", () => {
  describe("given the filtered counts have not landed", () => {
    /** @scenario "Counts next to values are hidden until the filtered counts land" */
    it("shows the value without a number", () => {
      const { container } = renderRow({
        value: "error",
        label: "error",
        count: 0,
        countState: "pending",
      });
      expect(container).toHaveTextContent("error");
      expect(countOf(container)).toBeNull();
    });
  });

  describe("given the count is for the active filter", () => {
    it("shows the number", () => {
      const { container } = renderRow({
        value: "error",
        label: "error",
        count: 12,
        countState: "settled",
      });
      expect(countOf(container)).toHaveTextContent("12");
    });
  });

  describe("given a newer filtered read is in flight", () => {
    it("keeps the previous number, muted", () => {
      const { container } = renderRow({
        value: "error",
        label: "error",
        count: 12,
        countState: "stale",
      });
      const count = countOf(container);
      expect(count).toHaveTextContent("12");
      expect(count).toHaveStyle({ opacity: "0.4" });
    });
  });
});
