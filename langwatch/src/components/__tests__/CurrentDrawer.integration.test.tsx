/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import { OrganizationUserRole } from "@prisma/client";
import { CurrentDrawer } from "../CurrentDrawer";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

let mockQuery: Record<string, string> = {};
const mockPush = vi.fn();
const mockReplace = vi.fn();

vi.mock("next/router", () => ({
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

// Mock the drawer registry so we don't need to render real drawers
vi.mock("../drawerRegistry", () => ({
  drawers: {
    traceDetails: function MockTraceDetailsDrawer() {
      return <div data-testid="trace-details-drawer">Trace Details</div>;
    },
    promptList: function MockPromptListDrawer() {
      return <div data-testid="prompt-list-drawer">Prompt List</div>;
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

      it("does not render the trace details drawer", () => {
        const { queryByTestId } = render(<CurrentDrawer />);

        expect(queryByTestId("trace-details-drawer")).toBeNull();
      });

      it("opens the lite member restriction modal", () => {
        render(<CurrentDrawer />);

        expect(mockOpenLiteMemberRestriction).toHaveBeenCalledWith({
          resource: "traces",
        });
      });

      it("clears the drawer URL params", () => {
        render(<CurrentDrawer />);

        expect(mockPush).toHaveBeenCalled();
        const pushUrl = mockPush.mock.calls[0]?.[0] as string;
        expect(pushUrl).not.toContain("drawer");
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
});
