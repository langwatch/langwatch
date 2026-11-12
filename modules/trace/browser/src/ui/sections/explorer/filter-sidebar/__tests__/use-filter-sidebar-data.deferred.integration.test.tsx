/**
 * When the sidebar asks for a deferred facet's counts: never on load, once its
 * section shows and is open (the reader's choice, else an active filter), and
 * its rows read as pending until that keyed read answers.
 * @see specs/traces-v2/search.feature
 * @vitest-environment jsdom
 */

import { renderHook } from "@testing-library/react";
import { parse } from "liqe";
import { beforeEach, describe, expect, it, vi } from "vitest";

// ─── Mutable state ────────────────────────────────────────────────────────────

const EMPTY_AST = { type: "EmptyExpression", location: { start: 0, end: 0 } };

let mockAst: unknown = EMPTY_AST;
let mockSectionOpen: Record<string, boolean> = {};
let mockKeyedAnswer: { data: unknown[] | undefined; isPlaceholderData: boolean } = {
  data: undefined,
  isPlaceholderData: false,
};
const keyedReads: (readonly string[] | undefined)[] = [];

const DISCOVERED = [
  {
    kind: "categorical",
    key: "status",
    label: "Status",
    group: "trace",
    topValues: [{ value: "ok", count: 3 }],
    totalDistinct: 1,
  },
  {
    kind: "categorical",
    key: "spanType",
    label: "Span type",
    group: "span",
    topValues: [],
    totalDistinct: 0,
    deferred: true,
  },
];

// ─── Dependency mocks ─────────────────────────────────────────────────────────

vi.mock("../../../../../behavior/use-organization-team-project.ts", () => ({
  useOrganizationTeamProject: () => ({
    project: { id: "proj-deferred-test" },
    organization: { id: "org-1" },
  }),
}));

vi.mock("../../../../../behavior/explorer/onboarding/use-preview-traces-active.ts", () => ({
  usePreviewTracesActive: () => false,
}));

vi.mock("../../../../../features/facet/behavior/use-trace-facets.ts", () => ({
  useTraceFacets: () => ({ data: DISCOVERED, isLoading: false }),
}));

// The plain counts read has answered, span type listed without values as the
// server sends it; the keyed read answers `mockKeyedAnswer`.
vi.mock("../../../../../features/facet/behavior/use-filtered-trace-facets.ts", () => ({
  useFilteredTraceFacets: ({ facetKeys }: { facetKeys?: readonly string[] } = {}) => {
    if (facetKeys === undefined) {
      return { data: DISCOVERED, isPlaceholderData: false, isFetching: false, isError: false };
    }
    keyedReads.push(facetKeys);
    return facetKeys.length > 0
      ? { ...mockKeyedAnswer, isFetching: false, isError: false }
      : { data: undefined, isPlaceholderData: false, isFetching: false, isError: false };
  },
}));

vi.mock("../../../../../features/explorer/behavior/density.store.ts", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useDensityStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({ density: "compact" }),
}));

vi.mock(
  "../../../../../features/facet/behavior/facet-visibility.store.ts",
  async (importOriginal) => ({
    ...(await importOriginal<Record<string, unknown>>()),
    useFacetVisibilityStore: (selector: (state: Record<string, unknown>) => unknown) =>
      selector({
        showFacet: vi.fn(),
        hideFacet: vi.fn(),
        resetAll: vi.fn(),
        hydrateFromStorage: vi.fn(),
      }),
    selectVisibilityFor: () => ({ hidden: [], shown: [] }),
  }),
);

vi.mock("../../../../../behavior/explorer.store.ts", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    useFilterStore: (selector: (s: unknown) => unknown) =>
      selector({
        ast: mockAst,
        queryText: "",
        applyQueryText: vi.fn(),
        toggleFacet: vi.fn(),
        clearAll: vi.fn(),
      }),
  };
});

vi.mock("../../../../../features/facet/behavior/facet-lens.store.ts", () => ({
  useFacetLensStore: (selector: (s: unknown) => unknown) =>
    selector({
      lens: { sectionOrder: [], groupOrder: [], sectionOpen: mockSectionOpen },
      setSectionOrder: vi.fn(),
      setGroupOrder: vi.fn(),
      setAllSectionsOpen: vi.fn(),
    }),
  applyLensOrder: (keys: string[]) => keys,
}));

// ─── Module under test ────────────────────────────────────────────────────────

import { useFilterSidebarData } from "../hooks/use-filter-sidebar-data.ts";

beforeEach(() => {
  mockAst = EMPTY_AST;
  mockSectionOpen = {};
  mockKeyedAnswer = { data: undefined, isPlaceholderData: false };
  keyedReads.length = 0;
});

function lastKeyedRead() {
  return keyedReads[keyedReads.length - 1];
}

describe("useFilterSidebarData()", () => {
  describe("given the span type section is closed and unfiltered", () => {
    /** @scenario "Span type is counted only once its section is opened" */
    it("asks for no deferred counts", () => {
      renderHook(() => useFilterSidebarData());

      expect(lastKeyedRead()).toEqual([]);
    });

    /** @scenario "Span type is counted only once its section is opened" */
    it("still lists the span type section, its rows pending", () => {
      const { result } = renderHook(() => useFilterSidebarData());

      expect(result.current.sectionByKey.has("spanType")).toBe(true);
      for (const item of result.current.facetItems.get("spanType") ?? [])
        expect(item.countState).toBe("pending");
    });
  });

  describe("given the reader opens the span type section", () => {
    /** @scenario "Span type is counted only once its section is opened" */
    it("asks for span type alone", () => {
      mockSectionOpen = { spanType: true };

      renderHook(() => useFilterSidebarData());

      expect(lastKeyedRead()).toEqual(["spanType"]);
    });
  });

  describe("given a span type filter is active", () => {
    /** @scenario "An active span type filter counts span type" */
    it("asks for span type alone", () => {
      mockAst = parse("spanType:llm");

      renderHook(() => useFilterSidebarData());

      expect(lastKeyedRead()).toEqual(["spanType"]);
    });
  });

  describe("given a span type filter is active but the reader closed the section", () => {
    /** @scenario "An active span type filter counts span type" */
    it("asks for no deferred counts", () => {
      mockAst = parse("spanType:llm");
      mockSectionOpen = { spanType: false };

      renderHook(() => useFilterSidebarData());

      expect(lastKeyedRead()).toEqual([]);
    });
  });

  describe("given the keyed read is still answering from a previous query", () => {
    /** @scenario "Span type is counted only once its section is opened" */
    it("keeps the span type rows pending", () => {
      mockSectionOpen = { spanType: true };
      mockKeyedAnswer = {
        data: [{ ...DISCOVERED[1], topValues: [{ value: "llm", count: 9 }], totalDistinct: 1 }],
        isPlaceholderData: true,
      };

      const { result } = renderHook(() => useFilterSidebarData());

      const descriptor = result.current.descriptors?.find((d) => d.key === "spanType");
      expect(descriptor).toMatchObject({ deferred: true, topValues: [] });
    });
  });

  describe("given the keyed read answers", () => {
    /** @scenario "Span type is counted only once its section is opened" */
    it("fills the span type values and settles its rows", () => {
      mockSectionOpen = { spanType: true };
      mockKeyedAnswer = {
        data: [{ ...DISCOVERED[1], topValues: [{ value: "llm", count: 9 }], totalDistinct: 1 }],
        isPlaceholderData: false,
      };

      const { result } = renderHook(() => useFilterSidebarData());

      const items = result.current.facetItems.get("spanType") ?? [];
      expect(items.find((item) => item.value === "llm")).toMatchObject({ count: 9 });
      for (const item of items) expect(item.countState).not.toBe("pending");
    });
  });
});
