/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { OrganizationUserRole } from "@prisma/client";
import { CurrentDrawer } from "../CurrentDrawer";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

let mockQuery: Record<string, string> = {};
const mockPush = vi.fn();
const mockReplace = vi.fn();

vi.mock("~/utils/compat/next-router", () => ({
  useRouter: () => ({
    query: mockQuery,
    asPath:
      Object.keys(mockQuery).length > 0
        ? "?" + new URLSearchParams(mockQuery).toString()
        : "/",
    push: mockPush,
    replace: mockReplace,
  }),
}));

vi.mock("../../hooks/useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: vi.fn(),
}));

const mockOpenLiteMemberRestriction = vi.fn();
const mockClose = vi.fn();

vi.mock("../../stores/upgradeModalStore", () => ({
  useUpgradeModalStore: Object.assign(
    vi.fn(() => ({
      openLiteMemberRestriction: mockOpenLiteMemberRestriction,
    })),
    {
      getState: () => ({
        openLiteMemberRestriction: mockOpenLiteMemberRestriction,
        close: mockClose,
      }),
    },
  ),
}));

// Flag to control whether the crashingDrawer throws
let shouldCrash = true;

// Mock the drawer registry so we don't need to render real drawers
vi.mock("../drawerRegistry", () => ({
  drawers: {
    traceDetails: function MockTraceDetailsDrawer() {
      return <div data-testid="trace-details-drawer">Trace Details</div>;
    },
    promptList: function MockPromptListDrawer() {
      return <div data-testid="prompt-list-drawer">Prompt List</div>;
    },
    // Drawer that crashes when shouldCrash is true — used to test ErrorBoundary recovery
    seriesFilters: function MockCrashingDrawer() {
      if (shouldCrash) {
        throw new Error("Cannot read properties of undefined");
      }
      return <div data-testid="series-filters-drawer">Series Filters</div>;
    },
  },
}));

vi.mock("../ui/drawer", () => ({
  DrawerOffsetProvider: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
}));

import { useOrganizationTeamProject } from "../../hooks/useOrganizationTeamProject";

const mockUseOrganizationTeamProject = vi.mocked(useOrganizationTeamProject);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function setupOrganizationRole(role: OrganizationUserRole | undefined) {
  mockUseOrganizationTeamProject.mockReturnValue({
    organizationRole: role,
  } as ReturnType<typeof useOrganizationTeamProject>);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("<CurrentDrawer/>", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockQuery = {};
    shouldCrash = true;
    setupOrganizationRole(OrganizationUserRole.MEMBER);
  });

  afterEach(() => {
    cleanup();
  });

  describe("when drawer type is traceDetails", () => {
    beforeEach(() => {
      mockQuery = { "drawer.open": "traceDetails", "drawer.traceId": "t-1" };
    });

    describe("when user is EXTERNAL", () => {
      beforeEach(() => {
        setupOrganizationRole(OrganizationUserRole.EXTERNAL);
      });

      it("renders the trace details drawer", () => {
        const { getByTestId } = render(<CurrentDrawer />);

        expect(getByTestId("trace-details-drawer")).toBeTruthy();
      });

      it("does not open the restriction modal", () => {
        render(<CurrentDrawer />);

        expect(mockOpenLiteMemberRestriction).not.toHaveBeenCalled();
      });
    });

    describe("when user is MEMBER", () => {
      beforeEach(() => {
        setupOrganizationRole(OrganizationUserRole.MEMBER);
      });

      it("renders the trace details drawer", () => {
        const { getByTestId } = render(<CurrentDrawer />);

        expect(getByTestId("trace-details-drawer")).toBeTruthy();
      });

      it("does not open the restriction modal", () => {
        render(<CurrentDrawer />);

        expect(mockOpenLiteMemberRestriction).not.toHaveBeenCalled();
      });
    });

    describe("when user is ADMIN", () => {
      beforeEach(() => {
        setupOrganizationRole(OrganizationUserRole.ADMIN);
      });

      it("renders the trace details drawer", () => {
        const { getByTestId } = render(<CurrentDrawer />);

        expect(getByTestId("trace-details-drawer")).toBeTruthy();
      });

      it("does not open the restriction modal", () => {
        render(<CurrentDrawer />);

        expect(mockOpenLiteMemberRestriction).not.toHaveBeenCalled();
      });
    });
  });

  describe("when drawer type is not traceDetails", () => {
    beforeEach(() => {
      mockQuery = { "drawer.open": "promptList" };
    });

    describe("when user is EXTERNAL", () => {
      beforeEach(() => {
        setupOrganizationRole(OrganizationUserRole.EXTERNAL);
      });

      it("renders the drawer normally", () => {
        const { getByTestId } = render(<CurrentDrawer />);

        expect(getByTestId("prompt-list-drawer")).toBeTruthy();
      });

      it("does not open the restriction modal", () => {
        render(<CurrentDrawer />);

        expect(mockOpenLiteMemberRestriction).not.toHaveBeenCalled();
      });
    });
  });

  describe("when no drawer is open", () => {
    beforeEach(() => {
      mockQuery = {};
    });

    it("renders nothing", () => {
      const { container } = render(<CurrentDrawer />);

      expect(container.innerHTML).toBe("");
    });

    it("does not open the restriction modal", () => {
      render(<CurrentDrawer />);

      expect(mockOpenLiteMemberRestriction).not.toHaveBeenCalled();
    });
  });

  describe("when a drawer crashes and is replaced by a different drawer", () => {
    // @regression: ErrorBoundary without resetKeys stayed in error state after
    // a crash, blocking ALL drawers from rendering. Adding resetKeys={[drawerType]}
    // ensures recovery when switching drawer types.

    it("recovers and renders the new drawer", () => {
      // Suppress console.error from ErrorBoundary catching the crash
      const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      // First: render a crashing drawer
      shouldCrash = true;
      mockQuery = { "drawer.open": "seriesFilters" };
      const { rerender } = render(<CurrentDrawer />);

      // Verify the crash was caught (drawer renders nothing via fallback)
      expect(screen.queryByTestId("series-filters-drawer")).toBeNull();

      // Second: switch to a working drawer (simulates user opening a different drawer)
      mockQuery = { "drawer.open": "traceDetails", "drawer.traceId": "t-1" };
      rerender(<CurrentDrawer />);

      // The ErrorBoundary should have reset via resetKeys and rendered the new drawer
      expect(screen.getByTestId("trace-details-drawer")).toBeTruthy();

      consoleSpy.mockRestore();
    });
  });
});
