/**
 * @vitest-environment jsdom
 *
 * The sidebar declutter pass: the "Find a facet" finder button is gone, and a
 * "More…" button below the facet list opens the same Configure popover the
 * header trigger drives (via the shared facetManagerOpen state).
 * See specs/traces-v2/filter-bar-interactions.feature.
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

const mockSetFacetManagerOpen = vi.fn();

vi.mock("~/hooks/useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: () => ({
    project: { id: "proj-declutter-test" },
    organization: { id: "org-1" },
  }),
}));

vi.mock("../../../hooks/useProjectHasTraces", () => ({
  useProjectHasTraces: () => ({ hasAnyTraces: true }),
}));

vi.mock("../../../hooks/useTraceFacets", () => ({
  useTraceFacets: () => ({
    data: [
      { kind: "categorical", key: "status", label: "Status", topValues: [] },
    ],
    isLoading: false,
  }),
}));

vi.mock("../../../stores/uiStore", () => ({
  useUIStore: (selector: (s: unknown) => unknown) =>
    selector({
      toggleSidebar: vi.fn(),
      facetManagerOpen: false,
      setFacetManagerOpen: mockSetFacetManagerOpen,
      sidebarCollapsed: false,
      sidebarWidth: null,
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
  arrayMove: (arr: unknown[]) => arr,
  verticalListSortingStrategy: vi.fn(),
}));

import type React from "react";
import { FilterSidebar } from "../FilterSidebar";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function renderSidebar() {
  return render(
    <ChakraProvider value={defaultSystem}>
      <FilterSidebar />
    </ChakraProvider>,
  );
}

describe("<FilterSidebar /> declutter", () => {
  describe("given the sidebar is open", () => {
    it("no longer renders the Find a facet button", () => {
      renderSidebar();
      expect(
        screen.queryByRole("button", { name: /find a facet/i }),
      ).not.toBeInTheDocument();
    });

    it("renders a More… button below the facet list", () => {
      renderSidebar();
      expect(screen.getByRole("button", { name: /more/i })).toBeInTheDocument();
    });
  });

  describe("when the user clicks More…", () => {
    it("opens the Configure facet manager", () => {
      renderSidebar();
      fireEvent.click(screen.getByRole("button", { name: /more/i }));
      expect(mockSetFacetManagerOpen).toHaveBeenCalledWith(true);
    });
  });
});
