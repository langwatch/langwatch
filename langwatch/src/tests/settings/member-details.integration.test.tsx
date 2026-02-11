/**
 * @vitest-environment jsdom
 */
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { OrganizationUserRole } from "@prisma/client";
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockPush,
  mockBack,
  mockUpdateMemberRoleMutateAsync,
  mockInvalidateMember,
  mockInvalidateAll,
  mockMemberData,
  mockHasOrgPermissionRef,
} = vi.hoisted(() => {
  const mockMemberData = {
    userId: "user-1",
    role: "MEMBER" as string,
    user: {
      id: "user-1",
      name: "Sergio",
      email: "sergio@example.com",
      teamMemberships: [] as Array<{
        teamId: string;
        role: string;
        team: {
          id: string;
          name: string;
          slug: string;
          organizationId: string;
        };
        assignedRole: null;
        userId: string;
      }>,
    },
  };

  return {
    mockPush: vi.fn(),
    mockBack: vi.fn(),
    mockUpdateMemberRoleMutateAsync: vi.fn(),
    mockInvalidateMember: vi.fn(),
    mockInvalidateAll: vi.fn(),
    mockMemberData,
    mockHasOrgPermissionRef: {
      current: (_permission: string): boolean =>
        _permission === "organization:manage",
    },
  };
});

vi.mock("next/router", () => ({
  useRouter: () => ({
    query: { userId: "user-1" },
    push: mockPush,
    back: mockBack,
  }),
}));

vi.mock("../../hooks/useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: () => ({
    organization: { id: "org-1" },
    hasOrgPermission: (permission: string) =>
      mockHasOrgPermissionRef.current(permission),
    hasPermission: () => false,
  }),
}));

vi.mock("../../hooks/useLicenseEnforcement", () => ({
  useLicenseEnforcement: () => ({
    checkAndProceed: (callback: () => void) => callback(),
    isAllowed: true,
    isLoading: false,
    limitInfo: undefined,
  }),
}));

vi.mock("../../components/SettingsLayout", () => ({
  default: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
}));

vi.mock("../../components/settings/OrganizationUserRoleField", () => ({
  OrganizationUserRoleField: ({
    value,
    onChange,
  }: {
    value: string;
    onChange: (role: string) => void;
  }) => (
    <button
      type="button"
      data-testid="org-role-field"
      data-value={value}
      onClick={() => onChange("EXTERNAL")}
    >
      Change Role
    </button>
  ),
}));

vi.mock("../../components/settings/TeamUserRoleField", () => ({
  MISSING_CUSTOM_ROLE_VALUE: "custom:missing",
  teamRolesOptions: {
    ADMIN: { label: "Admin", value: "ADMIN", description: "Admin" },
    MEMBER: { label: "Member", value: "MEMBER", description: "Member" },
    VIEWER: { label: "Viewer", value: "VIEWER", description: "Viewer" },
  },
  TeamUserRoleField: ({ value }: { value?: string }) => (
    <div data-testid="team-role-field" data-value={value}>
      Team Role Select
    </div>
  ),
}));

vi.mock("../../components/ui/toaster", () => ({
  toaster: {
    create: vi.fn(),
  },
}));

vi.mock("../../utils/api", () => ({
  api: {
    useContext: () => ({
      organization: {
        getMemberById: {
          invalidate: mockInvalidateMember,
        },
        getAll: {
          invalidate: mockInvalidateAll,
        },
      },
    }),
    team: {
      removeMember: {
        useMutation: () => ({
          mutate: vi.fn(),
          isLoading: false,
        }),
      },
    },
    organization: {
      getMemberById: {
        useQuery: () => ({
          data: mockMemberData,
        }),
      },
      updateMemberRole: {
        useMutation: () => ({
          mutateAsync: mockUpdateMemberRoleMutateAsync,
          isLoading: false,
        }),
      },
    },
  },
}));

// Lazy import to ensure mocks are set up first
const { default: MemberDetailsPage } = await import(
  "../../pages/settings/members/[userId]"
);

function resetMemberData() {
  mockMemberData.userId = "user-1";
  mockMemberData.role = OrganizationUserRole.MEMBER;
  mockMemberData.user.id = "user-1";
  mockMemberData.user.name = "Sergio";
  mockMemberData.user.email = "sergio@example.com";
  mockMemberData.user.teamMemberships = [];
}

describe("Member details page", () => {
  afterEach(() => {
    cleanup();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mockUpdateMemberRoleMutateAsync.mockResolvedValue({ success: true });
    mockInvalidateMember.mockResolvedValue(undefined);
    mockInvalidateAll.mockResolvedValue(undefined);
    mockPush.mockResolvedValue(true);
    mockHasOrgPermissionRef.current = (p: string) =>
      p === "organization:manage";
    resetMemberData();
  });

  describe("when organization role changes", () => {
    it("persists only after save is clicked", async () => {
      const user = userEvent.setup();
      render(
        <ChakraProvider value={defaultSystem}>
          <MemberDetailsPage />
        </ChakraProvider>,
      );

      await user.click(screen.getByTestId("org-role-field"));

      expect(mockUpdateMemberRoleMutateAsync).not.toHaveBeenCalled();

      await user.click(screen.getByRole("button", { name: "Save" }));

      await waitFor(() => {
        expect(mockUpdateMemberRoleMutateAsync).toHaveBeenCalledWith({
          organizationId: "org-1",
          userId: "user-1",
          role: OrganizationUserRole.EXTERNAL,
          teamRoleUpdates: [],
        });
      });
    });
  });

  describe("when saving a Lite Member update with existing team roles", () => {
    beforeEach(() => {
      mockMemberData.user.teamMemberships = [
        {
          teamId: "team-1",
          role: "ADMIN",
          team: {
            id: "team-1",
            name: "Team Alpha",
            slug: "team-alpha",
            organizationId: "org-1",
          },
          assignedRole: null,
          userId: "user-1",
        },
        {
          teamId: "team-2",
          role: "MEMBER",
          team: {
            id: "team-2",
            name: "Team Beta",
            slug: "team-beta",
            organizationId: "org-1",
          },
          assignedRole: null,
          userId: "user-1",
        },
      ];
    });

    it("enforces Viewer team role in every team", async () => {
      const user = userEvent.setup();
      render(
        <ChakraProvider value={defaultSystem}>
          <MemberDetailsPage />
        </ChakraProvider>,
      );

      // Wait for useEffect state sync to settle
      await waitFor(() => {
        expect(screen.getAllByTestId("org-role-field")).toHaveLength(1);
      });

      await user.click(screen.getByTestId("org-role-field"));

      await user.click(screen.getByRole("button", { name: "Save" }));

      await waitFor(() => {
        expect(mockUpdateMemberRoleMutateAsync).toHaveBeenCalledWith({
          organizationId: "org-1",
          userId: "user-1",
          role: OrganizationUserRole.EXTERNAL,
          teamRoleUpdates: expect.arrayContaining([
            expect.objectContaining({
              teamId: "team-1",
              userId: "user-1",
              role: "VIEWER",
            }),
            expect.objectContaining({
              teamId: "team-2",
              userId: "user-1",
              role: "VIEWER",
            }),
          ]),
        });
      });
    });
  });

  describe("when viewing a Lite Member's details as a non-admin", () => {
    beforeEach(() => {
      mockHasOrgPermissionRef.current = () => false;
      mockMemberData.role = OrganizationUserRole.EXTERNAL;
    });

    it("displays 'Lite Member' label instead of 'EXTERNAL'", () => {
      render(
        <ChakraProvider value={defaultSystem}>
          <MemberDetailsPage />
        </ChakraProvider>,
      );

      expect(screen.getByText("Lite Member")).toBeTruthy();
      expect(screen.queryByText("EXTERNAL")).toBeNull();
    });
  });

  describe("when user does not have organization administrator permissions", () => {
    beforeEach(() => {
      mockHasOrgPermissionRef.current = () => false;
      mockMemberData.user.teamMemberships = [
        {
          teamId: "team-1",
          role: "ADMIN",
          team: {
            id: "team-1",
            name: "Team Alpha",
            slug: "team-alpha",
            organizationId: "org-1",
          },
          assignedRole: null,
          userId: "user-1",
        },
        {
          teamId: "team-2",
          role: "MEMBER",
          team: {
            id: "team-2",
            name: "Team Beta",
            slug: "team-beta",
            organizationId: "org-1",
          },
          assignedRole: null,
          userId: "user-1",
        },
      ];
    });

    it("renders the organization role as read-only text", () => {
      render(
        <ChakraProvider value={defaultSystem}>
          <MemberDetailsPage />
        </ChakraProvider>,
      );

      expect(screen.queryByTestId("org-role-field")).toBeNull();
      expect(screen.getByText("Organization Member")).toBeTruthy();
    });

    it("renders team roles as read-only text", () => {
      render(
        <ChakraProvider value={defaultSystem}>
          <MemberDetailsPage />
        </ChakraProvider>,
      );

      expect(screen.queryByTestId("team-role-field")).toBeNull();

      const table = screen.getByRole("table");
      expect(within(table).getByText("Admin")).toBeTruthy();
      expect(within(table).getByText("Member")).toBeTruthy();
    });

    it("hides Save and Cancel buttons and shows Back button", () => {
      render(
        <ChakraProvider value={defaultSystem}>
          <MemberDetailsPage />
        </ChakraProvider>,
      );

      expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
      expect(screen.queryByRole("button", { name: "Cancel" })).toBeNull();
      expect(screen.getByRole("button", { name: "Back" })).toBeTruthy();
    });
  });
});
