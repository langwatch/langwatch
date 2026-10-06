/**
 * @vitest-environment jsdom
 *
 * The Origin facet in the real sidebar: leading section, one count per
 * origin, nothing checked until the reader picks one.
 * @see specs/traces-v2/trace-table.feature
 */
import { renderWithDesignSystem } from "@langwatch/design-system/testing";
import { cleanup, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

import { useFilterStore } from "../../../../../behavior/explorer.store.ts";
import { FilterSidebar } from "../filter-sidebar.tsx";
import { buildFacetItems } from "../hooks/use-filter-sidebar-data.ts";

vi.mock("../../../../../behavior/use-organization-team-project.ts", () => ({
  useOrganizationTeamProject: () => ({
    project: { id: "proj-origin-test" },
    organization: { id: "org-1" },
  }),
}));

vi.mock("../../../../../behavior/explorer/use-project-has-traces.ts", () => ({
  useProjectHasTraces: () => ({ hasAnyTraces: true }),
}));

const descriptors = vi.hoisted(() => [] as unknown[]);

vi.mock("../../hooks/use-trace-facets.ts", () => ({
  useTraceFacets: () => ({ data: descriptors, isLoading: false }),
}));

vi.mock("../../hooks/use-filtered-trace-facets.ts", () => ({
  useFilteredTraceFacets: () => ({
    data: descriptors,
    isPlaceholderData: false,
    isFetching: false,
    isError: false,
  }),
}));

vi.mock("../../hooks/use-facet-search.ts", () => ({
  useFacetSearch: () => ({ values: [], totalDistinct: 0, isLoading: false, isFetching: false }),
}));

vi.mock("../explorer-total.tsx", () => ({ ExplorerTotal: () => null }));

const categorical = ({
  key,
  label,
  group,
  topValues,
}: {
  key: string;
  label: string;
  group: string;
  topValues: { value: string; count: number }[];
}) => ({ kind: "categorical", key, label, group, topValues });

descriptors.push(
  categorical({
    key: "model",
    label: "Model",
    group: "trace",
    topValues: [{ value: "gpt-5-mini", count: 40 }],
  }),
  categorical({
    key: "origin",
    label: "Origin",
    group: "trace",
    topValues: [
      { value: "application", count: 31 },
      { value: "simulation", count: 7 },
      { value: "evaluation", count: 2 },
    ],
  }),
  categorical({
    key: "status",
    label: "Status",
    group: "trace",
    topValues: [{ value: "ok", count: 38 }],
  }),
);

beforeEach(() => {
  useFilterStore.getState().clearAll();
});

afterEach(() => cleanup());

const renderSidebar = () => renderWithDesignSystem(<FilterSidebar />);

describe("<FilterSidebar /> Origin facet", () => {
  describe("when the filter sidebar renders", () => {
    /** @scenario Origin facet is first in the sidebar */
    it("lists the Origin section above every other facet section", () => {
      renderSidebar();

      const headings = ["Origin", "Model", "Status"].map((name) => ({
        name,
        node: screen.getByText(name, { selector: "*" }),
      }));
      const origin = headings.find((h) => h.name === "Origin")!.node;
      for (const other of headings.filter((h) => h.name !== "Origin")) {
        expect(
          origin.compareDocumentPosition(other.node) & Node.DOCUMENT_POSITION_FOLLOWING,
        ).toBeTruthy();
      }
    });

    /** @scenario Origin facet is first in the sidebar */
    it("paints Origin at full strength while an ordinary facet is dimmed", () => {
      const section = (key: string) => ({
        kind: "cat" as const,
        key,
        label: key,

        topValues: [{ value: "application", count: 1 }],
      });

      const origin = buildFacetItems({ cat: section("origin"), isSynthetic: false });
      const model = buildFacetItems({ cat: section("model"), isSynthetic: false });

      expect(origin.every((item) => item.dimmed === false)).toBe(true);
      expect(model.every((item) => item.dimmed === true)).toBe(true);
    });

    /** @scenario Origin facet shows three values with counts */
    it("shows Application, Simulation and Evaluation, each with its count", () => {
      renderSidebar();

      const { container } = renderSidebar();

      const expected = [
        ["application", "Application", "31"],
        ["simulation", "Simulation", "7"],
        ["evaluation", "Evaluation", "2"],
      ] as const;
      for (const [value, label, count] of expected) {
        const row = container.querySelector(
          `[data-facet-field="origin"][data-facet-value="${value}"]`,
        );
        expect(row).toHaveTextContent(label);
        expect(row?.querySelector("[data-facet-count]")).toHaveTextContent(count);
      }
    });
  });

  describe("when the Observe page loads", () => {
    /** @scenario No origin selected by default */
    it("leaves every origin checkbox unchecked and the query empty", () => {
      renderSidebar();

      expect(useFilterStore.getState().queryText).toBe("");
      const checked = screen
        .queryAllByRole("checkbox")
        .filter(
          (box) => (box as HTMLInputElement).checked || box.getAttribute("aria-checked") === "true",
        );
      expect(checked).toHaveLength(0);
    });
  });
});
