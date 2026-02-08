/**
 * @vitest-environment jsdom
 */
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { OrganizationUserRole } from "@prisma/client";
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import MemberDetailsPage from "../members/[userId]";

const mockPush = vi.fn();
const mockUpdateMemberRoleMutateAsync = vi.fn();
const mockUpdateTeamMemberRoleMutateAsync = vi.fn();
const mockInvalidateMember = vi.fn();
const mockInvalidateAll = vi.fn();
const mockMemberData = {
  userId: "user-1",
  role: OrganizationUserRole.MEMBER,
  user: {
    id: "user-1",
    name: "Sergio",
    email: "sergio@example.com",
    teamMemberships: [],
  },
};

vi.mock("next/router", () => ({
  useRouter: () => ({
    query: { userId: "user-1" },
    push: mockPush,
    back: vi.fn(),
  }),
}));

vi.mock("../../../hooks/useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: () => ({
    organization: { id: "org-1" },
    hasOrgPermission: (permission: string) => permission === "organization:manage",
    hasPermission: () => false,
  }),
}));

vi.mock("../../../hooks/useLicenseEnforcement", () => ({
  useLicenseEnforcement: () => ({
    checkAndProceed: (callback: () => void) => callback(),
    isAllowed: true,
    isLoading: false,
    limitInfo: undefined,
  }),
}));

vi.mock("../../../components/SettingsLayout", () => ({
  default: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
}));

vi.mock("../../../components/settings/OrganizationUserRoleField", () => ({
  OrganizationUserRoleField: ({
    value,
    onChange,
  }: {
    value: OrganizationUserRole;
    onChange: (role: OrganizationUserRole) => void;
  }) => (
    <button
      type="button"
      data-testid="org-role-field"
      data-value={value}
      onClick={() => onChange(OrganizationUserRole.EXTERNAL)}
    >
      Change Role
    </button>
  ),
}));

vi.mock("../../../components/ui/toaster", () => ({
  toaster: {
    create: vi.fn(),
  },
}));

vi.mock("../../../utils/api", () => ({
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
      updateTeamMemberRole: {
        useMutation: () => ({
          mutateAsync: mockUpdateTeamMemberRoleMutateAsync,
          isLoading: false,
        }),
      },
    },
  },
}));

describe("Member details page", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUpdateMemberRoleMutateAsync.mockResolvedValue({ success: true });
    mockUpdateTeamMemberRoleMutateAsync.mockResolvedValue({ success: true });
    mockInvalidateMember.mockResolvedValue(undefined);
    mockInvalidateAll.mockResolvedValue(undefined);
    mockPush.mockResolvedValue(true);
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
        });
      });
    });
  });
});
