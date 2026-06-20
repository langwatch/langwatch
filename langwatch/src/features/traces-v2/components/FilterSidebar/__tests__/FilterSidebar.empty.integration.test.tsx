/**
 * @vitest-environment jsdom
 *
 * Integration tests for FilterSidebar empty-state behaviour.
 * Verifies that the sidebar hides when descriptors are empty and the
 * project has no real traces, stays visible during genuine loading, and
 * becomes visible once real data arrives.
 */

import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

// ─── Mutable state ────────────────────────────────────────────────────────────

let mockHasAnyTraces: boolean | undefined = false;
let mockFacetsLoading = false;
let mockDescriptors: unknown[] = [];

// ─── Dependency mocks ─────────────────────────────────────────────────────────

vi.mock("~/hooks/useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: () => ({
    project: { id: "proj-sidebar-test" },
    organization: { id: "org-1" },
  }),
}));

vi.mock("../../../hooks/useProjectHasTraces", () => ({
  useProjectHasTraces: () => ({ hasAnyTraces: mockHasAnyTraces }),
}));

vi.mock("../../../hooks/useTraceFacets", () => ({
  useTraceFacets: () => ({
    data: mockDescriptors,
    isLoading: mockFacetsLoading,
  }),
}));

vi.mock("../../../stores/uiStore", () => ({
  useUIStore: (selector: (s: unknown) => unknown) =>
    selector({
      toggleSidebar: vi.fn(),
      facetManagerOpen: false,
      setFacetManagerOpen: vi.fn(),
      sidebarCollapsed: false,
    }),
}));

vi.mock("../../../stores/filterStore", () => ({
  useFilterStore: (selector: (s: unknown) => unknown) =>
    selector({
      ast: { type: "group", combinator: "and", filters: [] },
      queryText: "",
      clearAll: vi.fn(),
    }),
}));

vi.mock("../../../stores/viewStore", () => ({
  useViewStore: (selector: (s: unknown) => unknown) =>
    selector({
      activeLensId: "all-traces",
      isDraft: () => false,
      revertLens: vi.fn(),
      allLenses: [{ id: "all-traces", name: "All" }],
    }),
}));

vi.mock("../../../stores/densityStore", () => ({
  useDensityStore: (selector: (s: unknown) => unknown) =>
    selector({ density: "comfortable" }),
}));

vi.mock("../../../stores/facetLensStore", () => ({
  useFacetLensStore: (selector: (s: unknown) => unknown) =>
    selector({
      lens: { sectionOrder: [], groupOrder: [] },
      setSectionOrder: vi.fn(),
      setGroupOrder: vi.fn(),
      setAllSectionsOpen: vi.fn(),
    }),
  applyLensOrder: (keys: string[]) => keys,
}));

vi.mock("../../../stores/facetVisibilityStore", () => ({
  useFacetVisibilityStore: (selector: (s: unknown) => unknown) =>
    selector({
      showFacet: vi.fn(),
      hideFacet: vi.fn(),
      resetAll: vi.fn(),
      hydrateFromStorage: vi.fn(),
    }),
  selectVisibilityFor: () => ({ hidden: [], shown: [] }),
}));

vi.mock("~/server/app-layer/traces/query-language/queries", () => ({
  analyzeOrGroups: () => ({ groups: [], fieldToGroupIds: new Map() }),
  buildFacetStateLookup: () => new Map(),
  getFacetValues: () => ({
    include: new Set<string>(),
    exclude: new Set<string>(),
  }),
}));

// Stub the heavy sub-components so we only test the visibility decision
vi.mock("../FacetManagerPopover", () => ({
  FacetManagerPopover: () => <div data-testid="facet-manager" />,
}));

vi.mock("../SectionRenderer", () => ({
  SectionRenderer: () => <div data-testid="section-renderer" />,
}));

vi.mock("../SortableSection", () => ({
  SortableSection: ({
    children,
  }: {
    children: (p: unknown) => React.ReactNode;
  }) => <div>{children({})}</div>,
}));

vi.mock("../FilterSidebarSkeleton", () => ({
  FilterSidebarSkeleton: () => <div data-testid="filter-sidebar-skeleton" />,
}));

vi.mock("@dnd-kit/core", () => ({
  DndContext: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  DragOverlay: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  closestCenter: vi.fn(),
  PointerSensor: vi.fn(),
  KeyboardSensor: vi.fn(),
  useSensor: vi.fn(() => ({})),
  useSensors: vi.fn(() => []),
}));

vi.mock("@dnd-kit/sortable", () => ({
  SortableContext: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
  sortableKeyboardCoordinates: vi.fn(),
  arrayMove: (arr: unknown[], from: number, to: number) => {
    const result = [...(arr as unknown[])];
    const [item] = result.splice(from, 1);
    result.splice(to, 0, item);
    return result;
  },
  verticalListSortingStrategy: vi.fn(),
}));

// ─── Module under test ────────────────────────────────────────────────────────

import type React from "react";
import { FilterSidebar } from "../FilterSidebar";

// ─── Test lifecycle ───────────────────────────────────────────────────────────

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

beforeEach(() => {
  mockHasAnyTraces = false;
  mockFacetsLoading = false;
  mockDescriptors = [];
});

function renderSidebar() {
  return render(
    <ChakraProvider value={defaultSystem}>
      <FilterSidebar />
    </ChakraProvider>,
  );
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("<FilterSidebar />", () => {
  describe("given project has no real traces", () => {
    describe("when discover has returned with no descriptors", () => {
      it("renders nothing (hidden entirely)", () => {
        mockHasAnyTraces = false;
        mockFacetsLoading = false;
        mockDescriptors = [];

        const { container } = renderSidebar();

        expect(container).toBeEmptyDOMElement();
      });
    });

    describe("when discover is still loading (genuine loading state)", () => {
      it("renders the sidebar (loading state visible)", () => {
        mockHasAnyTraces = false;
        mockFacetsLoading = true;
        mockDescriptors = [];

        renderSidebar();

        // The loading caption or skeleton should be present
        expect(
          screen.getByRole("complementary", { hidden: true }) ??
            screen.getByText(/getting filters ready/i) ??
            // The VStack container is what renders when loading
            document.querySelector("[role=complementary]"),
        ).toBeDefined();
      });
    });
  });

  describe("given project has real traces", () => {
    describe("when descriptors have populated", () => {
      it("renders the sidebar", () => {
        mockHasAnyTraces = true;
        mockFacetsLoading = false;
        mockDescriptors = [{ key: "serviceName", type: "categorical" }];

        const { container } = renderSidebar();

        expect(container).not.toBeEmptyDOMElement();
      });
    });

    describe("when descriptors are empty but traces exist", () => {
      it("renders the sidebar (the no-data case is not the no-traces case)", () => {
        mockHasAnyTraces = true;
        mockFacetsLoading = false;
        mockDescriptors = [];

        const { container } = renderSidebar();

        // hasAnyTraces=true → sidebar should be visible even with 0 descriptors
        expect(container).not.toBeEmptyDOMElement();
      });

      it("falls back to the default minimal facet set (not a blank rail)", () => {
        mockHasAnyTraces = true;
        mockFacetsLoading = false;
        mockDescriptors = [];

        renderSidebar();

        // The container always has the header bar, so a non-empty DOM is a
        // weak signal. The load-bearing check is that real facet SECTIONS
        // render — the synthetic FACET_DEFAULTS visible under comfortable
        // density. Zero here = the blank-rail regression.
        expect(
          screen.getAllByTestId("section-renderer").length,
        ).toBeGreaterThan(0);
      });
    });

    describe("when discover returns descriptors that all partition away", () => {
      it("falls back to the default minimal facet set (not a blank rail)", () => {
        mockHasAnyTraces = true;
        mockFacetsLoading = false;
        // Discover responded with descriptors, but every categorical has
        // zero buckets and every range a zero span — nothing usable
        // survives partitioning. Before the fix this collapsed the rail to
        // zero sections because synthesis only fired on an EMPTY descriptor
        // list, not on a "non-empty but all-dropped" one.
        mockDescriptors = [
          {
            kind: "categorical",
            key: "status",
            label: "Status",
            topValues: [],
          },
          { kind: "categorical", key: "model", label: "Model", topValues: [] },
          { kind: "range", key: "duration", label: "Duration", min: 0, max: 0 },
        ];

        renderSidebar();

        expect(
          screen.getAllByTestId("section-renderer").length,
        ).toBeGreaterThan(0);
      });
    });
  });
});
