/**
 * @vitest-environment jsdom
 *
 * The attribute and metadata sections read each value's state from the sidebar's display lookup,
 * so a value a group makes optional says "in group" there too.
 * @see specs/traces-v2/search.feature
 */
import { renderWithDesignSystem } from "@langwatch/design-system/testing";
import { buildFacetDisplayLookup, parse } from "@langwatch/trace-contract";
import { cleanup, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

import type { AttributesSectionData } from "../../../../../behavior/explorer/filter-sidebar/types.ts";
import { SectionRenderer } from "../section-renderer.tsx";

vi.mock("../../../../../features/facet/behavior/use-attribute-values.ts", () => ({
  useAttributeValues: ({ enabled }: { enabled: boolean }) => ({
    values: enabled
      ? [
          { value: "acme", count: 4 },
          { value: "globex", count: 2 },
        ]
      : [],
    isLoading: false,
  }),
}));

const METADATA_SECTION: AttributesSectionData = {
  kind: "attributes",
  key: "metadata",
  label: "Metadata",
  group: "metadata",
  filterPrefix: "attribute",
  keys: [{ value: "metadata.customer", count: 6 }],
  displayStripPrefix: "metadata.",
};

const renderMetadataSection = async ({ query }: { query: string }) => {
  const ast = parse(query);
  renderWithDesignSystem(
    <SectionRenderer
      section={METADATA_SECTION}
      ast={ast}
      facetItemsByKey={new Map()}
      valueStateGetters={new Map()}
      displayStates={buildFacetDisplayLookup(ast)}
      toggleFacet={vi.fn()}
      excludeFacet={vi.fn()}
      setRange={vi.fn()}
      removeRange={vi.fn()}
      toggleEvaluatorSubFilter={vi.fn()}
      setEvaluatorScoreRange={vi.fn()}
      removeEvaluatorScoreRange={vi.fn()}
      onShiftToggle={vi.fn()}
      numericModeByKey={new Map()}
      setNumericMode={vi.fn()}
    />,
  );
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "Expand Metadata" }));
  await user.click(screen.getByRole("button", { name: /customer/ }));
};

afterEach(() => cleanup());

describe("<SectionRenderer /> for the metadata section", () => {
  describe("given a group in the query makes a metadata value optional", () => {
    /** @scenario "Attribute, metadata and event rows a group makes optional also say in group" */
    it("marks that value in group, neither checked nor excluded", async () => {
      await renderMetadataSection({
        query: "NOT (status:error AND attribute.metadata.customer:acme)",
      });

      const row = screen.getByRole("checkbox", {
        name: "acme — in group, click to remove from the group",
      });
      expect(row).not.toBeChecked();
      expect(row).not.toBePartiallyChecked();
      const card = screen.getByText("acme").closest("[data-state]");
      expect(card).toHaveAttribute("data-state", "grouped-exclude");
      expect(card?.querySelector("[data-facet-grouped]")).toHaveTextContent("in group");
      expect(screen.getByRole("checkbox", { name: "globex — click to include" })).not.toBeChecked();
    });
  });

  describe("given the query requires a metadata value", () => {
    it("keeps it included", async () => {
      await renderMetadataSection({ query: "attribute.metadata.customer:acme AND status:error" });

      expect(screen.getByRole("checkbox", { name: "acme — included" })).toBeChecked();
    });
  });
});
