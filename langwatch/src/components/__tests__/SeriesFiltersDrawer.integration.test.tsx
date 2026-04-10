/**
 * @vitest-environment jsdom
 * @regression
 *
 * Regression tests for SeriesFiltersDrawer crash when opened without
 * complexProps (e.g., after page reload with drawer in URL).
 *
 * Bug: filters prop is undefined → FieldsFilter accesses filters["traces.origin"]
 * on undefined → TypeError crash → ErrorBoundary catches → all drawers blocked.
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock tRPC
vi.mock("../../utils/api", () => ({
  api: {
    analytics: {
      dataForFilter: {
        useQuery: () => ({ data: { options: [] }, isLoading: false }),
      },
    },
  },
}));

// Mock useFilterParams
vi.mock("../../hooks/useFilterParams", () => ({
  useFilterParams: () => ({
    filterParams: {},
    queryOpts: { enabled: false },
    nonEmptyFilters: {},
    setFilters: vi.fn(),
  }),
}));

// Mock useDrawer
const mockCloseDrawer = vi.fn();
vi.mock("~/hooks/useDrawer", () => ({
  useDrawer: () => ({
    closeDrawer: mockCloseDrawer,
    openDrawer: vi.fn(),
  }),
}));

// Mock useOrganizationTeamProject
vi.mock("~/hooks/useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: () => ({
    project: { id: "test-project" },
    organization: { id: "test-org" },
    hasPermission: () => true,
  }),
}));

// Mock useFeatureFlag
vi.mock("~/hooks/useFeatureFlag", () => ({
  useFeatureFlag: () => ({ enabled: false }),
}));

import { SeriesFiltersDrawer } from "../SeriesFilterDrawer";
import type { FilterParam } from "../../hooks/useFilterParams";
import type { FilterField } from "../../server/filters/types";

function renderDrawer(
  props: Partial<Parameters<typeof SeriesFiltersDrawer>[0]> = {},
) {
  const defaultProps = {
    filters: {} as Record<FilterField, FilterParam>,
    onChange: vi.fn(),
  };

  return render(
    <ChakraProvider value={defaultSystem}>
      <SeriesFiltersDrawer {...defaultProps} {...props} />
    </ChakraProvider>,
  );
}

describe("<SeriesFiltersDrawer/>", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  describe("when filters prop is undefined", () => {
    it("renders without crashing", () => {
      // @regression: filters is undefined when complexProps is lost (page
      // reload, ErrorBoundary recovery). Previously crashed with:
      // TypeError: Cannot read properties of undefined (reading 'traces.origin')
      expect(() =>
        renderDrawer({
          filters: undefined as unknown as Record<FilterField, FilterParam>,
        }),
      ).not.toThrow();
    });

    it("renders filter fields with empty defaults", () => {
      renderDrawer({
        filters: undefined as unknown as Record<FilterField, FilterParam>,
      });

      expect(screen.getByText("Origin")).toBeInTheDocument();
      expect(screen.getByText("Model")).toBeInTheDocument();
    });
  });

  describe("when onChange prop is undefined", () => {
    it("renders without crashing", () => {
      // @regression: onChange is lost when complexProps is cleared. The drawer
      // should still render; filter changes are silently dropped.
      expect(() =>
        renderDrawer({
          onChange: undefined as unknown as Parameters<
            typeof SeriesFiltersDrawer
          >[0]["onChange"],
        }),
      ).not.toThrow();
    });
  });

  describe("when both props are provided", () => {
    it("renders the filter heading", () => {
      renderDrawer();

      expect(screen.getByText("Edit Series Filter")).toBeInTheDocument();
    });

    it("renders the Done button", () => {
      renderDrawer();

      expect(screen.getByText("Done")).toBeInTheDocument();
    });
  });
});
