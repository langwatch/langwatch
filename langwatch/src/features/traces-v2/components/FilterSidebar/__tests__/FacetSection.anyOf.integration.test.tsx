/**
 * @vitest-environment jsdom
 *
 * "Any of" header hint on a facet section. Two or more INCLUDED values of
 * the same field combine with OR (a trace's field can equal only one value),
 * so the header surfaces a quiet "any of" hint to signal the values are
 * alternatives, not a narrowing AND — see specs/traces-v2/search.feature,
 * rule "Same-field multi-select shows an 'any of' header hint".
 */

import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import { Activity } from "lucide-react";
import { afterEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

import { FacetSection } from "../FacetSection";
import type { FacetItem, FacetValueState } from "../types";

const ITEMS: FacetItem[] = [
  { value: "error", label: "error", count: 9, dotColor: "red", dimmed: false },
  {
    value: "warning",
    label: "warning",
    count: 4,
    dotColor: "orange",
    dimmed: false,
  },
  { value: "ok", label: "ok", count: 80, dotColor: "green", dimmed: false },
];

const renderSection = (included: ReadonlySet<string>) => {
  const getValueState = (value: string): FacetValueState =>
    included.has(value) ? "include" : "neutral";
  return render(
    <ChakraProvider value={defaultSystem}>
      <FacetSection
        title="STATUS"
        icon={Activity}
        field="status"
        items={ITEMS}
        getValueState={getValueState}
        onToggle={vi.fn()}
        onExclude={vi.fn()}
      />
    </ChakraProvider>,
  );
};

afterEach(() => {
  cleanup();
});

describe("<FacetSection /> any-of header hint", () => {
  describe("given two values of the field are included", () => {
    /** @scenario "Two included values in one section show the any-of hint" */
    it("shows the any-of hint", () => {
      renderSection(new Set(["error", "warning"]));
      expect(screen.getByTestId("facet-any-of-hint")).toBeInTheDocument();
    });
  });

  describe("given only one value is included", () => {
    /** @scenario "A single included value shows no any-of hint" */
    it("shows no any-of hint", () => {
      renderSection(new Set(["error"]));
      expect(screen.queryByTestId("facet-any-of-hint")).not.toBeInTheDocument();
    });
  });
});
