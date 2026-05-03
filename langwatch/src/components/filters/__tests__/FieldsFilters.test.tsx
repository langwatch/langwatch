/**
 * @vitest-environment jsdom
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
const mockUseFilterParams = vi.fn(() => ({
  filterParams: {},
  queryOpts: { enabled: true },
  nonEmptyFilters: {},
  setFilters: vi.fn(),
}));
vi.mock("../../../hooks/useFilterParams", () => ({
  useFilterParams: () => mockUseFilterParams(),
}));

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

      // The button should show "Production" instead of "Any"
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

      // Should show "2" badge for two selected values
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

      // Check that popover is now open via aria-expanded
      expect(labelButton).toHaveAttribute("aria-expanded", "true");
    });
  });

});

// Note: Due to Chakra UI Popover rendering via Portal, deep integration tests
// for popover content (options, custom values, keyboard selection) are better
// tested via E2E tests. The component logic (highlighting, selection, custom
// values) works correctly in the browser but doesn't render properly in jsdom.
//
// The following features have been implemented and can be verified manually:
// - Custom value option appears when typing non-matching text
// - Keyboard navigation (ArrowUp/Down) highlights options
// - Enter key selects the highlighted option
// - Custom value can be selected via click or keyboard

/**
 * @regression #3749 — filter checkboxes on /messages no longer clickable.
 *
 * Root cause: PR #3528 swapped the option-row click handler from
 * `<Checkbox onClick={onChange_}>` to `<Checkbox onChange={onChange_}>`.
 * Our `<Checkbox>` wrapper spreads props onto Chakra v3's
 * `ChakraCheckbox.Root` (backed by Ark/Zag), which intercepts pointer
 * events on its label/control machinery — neither `onChange` nor
 * `onCheckedChange` fires reliably when the Checkbox is nested inside a
 * Popover + virtualizer in the production browser.
 *
 * The fix moves the click handler off the `<Checkbox>` and onto the
 * containing `<HStack>` row, so a click anywhere on the row triggers the
 * toggle. Verified empirically: clicking the row container fires the
 * handler; clicking the Checkbox does not.
 *
 * The test asserts: clicking the row container (not the Checkbox itself)
 * calls `setFilters` with the toggled value. Without the fix, the row
 * has no click handler and `setFilters` is never called.
 */
describe("@regression #3749 — filter option row click toggles setFilters", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  beforeEach(() => {
    mockUseQuery.mockReturnValue({
      data: { options: mockFilterOptions },
      isLoading: false,
    });
  });

  describe("given the user has opened a filter popover", () => {
    describe("when they click anywhere on a virtualised option row", () => {
      it("calls setFilters with the toggled value", async () => {
        const user = userEvent.setup();
        const setFilters = vi.fn();

        renderComponent({ setFilters });

        const labelButton = screen.getByText("Label").closest("button");
        await user.click(labelButton!);

        // Find the row container (HStack) that wraps the "Production" option.
        // Click the count text "100" — a sibling of the Checkbox — so the
        // click MUST traverse the row's onClick to register, never the
        // Checkbox's own handlers.
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
});
