/**
 * @vitest-environment jsdom
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock @tanstack/react-virtual so virtualizer items render in jsdom.
// jsdom returns zero for all layout measurements, which means useVirtualizer
// produces no virtual items. We replace it with a stub that returns every
// item directly so popover content is reachable from tests.
vi.mock("@tanstack/react-virtual", () => ({
  useVirtualizer: ({ count }: { count: number }) => ({
    getVirtualItems: () =>
      Array.from({ length: count }, (_, i) => ({
        index: i,
        start: i * 36,
        size: 36,
        end: (i + 1) * 36,
        key: i,
        lane: 0,
      })),
    getTotalSize: () => count * 36,
    measureElement: () => undefined,
  }),
}));

// Mock tRPC
const mockUseQuery = vi.fn();
vi.mock("../../../utils/api", () => ({
  api: {
    analytics: {
      dataForFilter: {
        useQuery: () => mockUseQuery(),
      },
    },
  },
}));

// Mock useFilterParams
vi.mock("../../../hooks/useFilterParams", () => ({
  useFilterParams: () => ({
    filterParams: {},
    queryOpts: { enabled: true },
    nonEmptyFilters: {},
    setFilters: vi.fn(),
  }),
}));

// Mock useDrawer
vi.mock("~/hooks/useDrawer", () => ({
  useDrawer: () => ({
    openDrawer: vi.fn(),
  }),
}));

// Mock useOrganizationTeamProject
vi.mock("~/hooks/useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: () => ({
    hasPermission: () => true,
  }),
}));

import { FieldsFilters } from "../FieldsFilters";
import type { FilterField } from "../../../server/filters/types";

const mockFilterOptions = [
  { field: "label-1", label: "Production", count: 100 },
  { field: "label-2", label: "Staging", count: 50 },
  { field: "label-3", label: "Development", count: 25 },
];

const renderComponent = (
  props: Partial<Parameters<typeof FieldsFilters>[0]> = {},
) => {
  const defaultProps = {
    filters: {} as Record<FilterField, string[]>,
    setFilters: vi.fn(),
  };

  return render(
    <ChakraProvider value={defaultSystem}>
      <FieldsFilters {...defaultProps} {...props} />
    </ChakraProvider>,
  );
};

describe("FieldsFilters", () => {
  beforeEach(() => {
    mockUseQuery.mockReturnValue({
      data: { options: mockFilterOptions },
      isLoading: false,
    });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  describe("rendering", () => {
    it("renders filter buttons", () => {
      renderComponent();
      expect(screen.getByText("Label")).toBeInTheDocument();
      expect(screen.getByText("Model")).toBeInTheDocument();
      expect(screen.getByText("User ID")).toBeInTheDocument();
    });

    it("shows 'Any' when no filter is selected", () => {
      renderComponent();
      const anyTexts = screen.getAllByText("Any");
      expect(anyTexts.length).toBeGreaterThan(0);
    });

    it("shows selected filter values in button", () => {
      renderComponent({
        filters: { "metadata.labels": ["Production"] } as Record<
          FilterField,
          string[]
        >,
      });

      const labelButton = screen.getByText("Label").closest("button");
      expect(labelButton).toHaveTextContent("Production");
    });

    it("shows count badge when multiple values selected", () => {
      renderComponent({
        filters: { "metadata.labels": ["Production", "Staging"] } as Record<
          FilterField,
          string[]
        >,
      });

      expect(screen.getByText("2")).toBeInTheDocument();
    });
  });

  describe("when filters is undefined", () => {
    it("renders without crashing", () => {
      // @regression: FieldsFilter accessed filters["traces.origin"] on
      // undefined, crashing the drawer. Fixed with optional chaining.
      expect(() =>
        renderComponent({
          filters: undefined as unknown as Record<FilterField, string[]>,
        }),
      ).not.toThrow();
    });
  });

  describe("popover interaction", () => {
    it("opens popover when clicking filter button", async () => {
      const user = userEvent.setup();
      renderComponent();

      const labelButton = screen.getByText("Label").closest("button");
      expect(labelButton).toBeInTheDocument();
      await user.click(labelButton!);

      expect(labelButton).toHaveAttribute("aria-expanded", "true");
    });
  });

  /**
   * @regression #3749 — filter checkboxes on /messages no longer clickable.
   *
   * PR #3528 moved the option-row click handler from `<HStack onClick=...>`
   * to `<Checkbox onChange=...>`. Inside the Popover + virtualizer, neither
   * `onChange` nor `onCheckedChange` on the Chakra v3 Checkbox fires
   * reliably — verified empirically: clicking the row container fires;
   * clicking the Checkbox itself does not.
   *
   * Fix: put the click handler back on the `<HStack>` row container.
   * The test asserts a click on a non-Checkbox sibling element (the count
   * text) toggles the filter — only the row's onClick can deliver that.
   */
  describe("when the user clicks an option row outside the Checkbox", () => {
    it("toggles the filter value", async () => {
      const user = userEvent.setup();
      const setFilters = vi.fn();

      renderComponent({ setFilters });

      const labelButton = screen.getByText("Label").closest("button");
      await user.click(labelButton!);

      // The count text "100" is a sibling of the Checkbox in the HStack.
      // Clicking it can ONLY reach the toggle handler if the handler is
      // on the row container, not on the Checkbox.
      const countText = screen.getByText("100");
      await user.click(countText);

      expect(setFilters).toHaveBeenCalledOnce();
      expect(setFilters).toHaveBeenCalledWith(
        expect.objectContaining({
          "metadata.labels": expect.arrayContaining(["label-1"]),
        }),
      );
    });
  });
});
