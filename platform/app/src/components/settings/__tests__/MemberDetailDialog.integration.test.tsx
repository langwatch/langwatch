/**
 * @vitest-environment jsdom
 *
 * Integration tests for MemberDetailDialog covering the save flow:
 * - Organization role field visibility gated by `canManage` and `isCurrentUser`
 * - Save wires up `organization.updateMemberRole` when only the role changed
 * - Save wires up `roleBinding.applyMemberBindings` when only bindings changed
 * - Save wires up both mutations when both changed (role first, then bindings)
 * - Cancel reverts pending state without firing mutations
 *
 * Covers P2 #4 from the CodeRabbit review on PR #3315 — restoring UI integration
 * coverage after the previous `member-details.integration.test.tsx` was removed
 * when the page was replaced by this dialog.
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { OrganizationUserRole, RoleBindingScopeType } from "@prisma/client";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PendingBinding } from "../GroupBindingInputRow";

const {
  mockUpdateMemberRole,
  mockApplyMemberBindings,
  mockInvalidateListForUser,
  mockInvalidateOrgWithMembers,
  mockInvalidateGetAll,
  mockToasterCreate,
  mockListForUserData,
  mockListForMemberData,
} = vi.hoisted(() => ({
  mockUpdateMemberRole: vi.fn(),
  mockApplyMemberBindings: vi.fn(),
  mockInvalidateListForUser: vi.fn().mockResolvedValue(undefined),
  mockInvalidateOrgWithMembers: vi.fn().mockResolvedValue(undefined),
  mockInvalidateGetAll: vi.fn().mockResolvedValue(undefined),
  mockToasterCreate: vi.fn(),
  mockListForUserData: {
    current: [] as Array<{
      id: string;
      role: string;
      customRoleName: string | null;
      scopeType: RoleBindingScopeType;
      scopeId: string;
      scopeName: string | null;
    }>,
  },
  mockListForMemberData: {
    current: [] as Array<unknown>,
  },
}));

vi.mock("~/utils/api", () => ({
  api: {
    useContext: () => ({
      roleBinding: {
        listForUser: { invalidate: mockInvalidateListForUser },
      },
      organization: {
        getOrganizationWithMembersAndTheirTeams: {
          invalidate: mockInvalidateOrgWithMembers,
        },
        getAll: { invalidate: mockInvalidateGetAll },
      },
    }),
    roleBinding: {
      listForUser: {
        useQuery: () => ({
          data: mockListForUserData.current,
          isLoading: false,
        }),
      },
      applyMemberBindings: {
        useMutation: () => ({ mutateAsync: mockApplyMemberBindings }),
      },
    },
    group: {
      listForMember: {
        useQuery: () => ({
          data: mockListForMemberData.current,
          isLoading: false,
        }),
      },
    },
    organization: {
      updateMemberRole: {
        useMutation: () => ({ mutateAsync: mockUpdateMemberRole }),
      },
    },
  },
}));

vi.mock("~/components/ui/toaster", () => ({
  toaster: { create: (...args: unknown[]) => mockToasterCreate(...args) },
}));

vi.mock("../OrganizationUserRoleField", () => ({
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
      Change role
    </button>
  ),
}));

vi.mock("../GroupBindingInputRow", async () => {
  const actual = await vi.importActual<typeof import("../GroupBindingInputRow")>(
    "../GroupBindingInputRow",
  );
  return {
    ...actual,
    BindingInputRow: ({
      onAdd,
    }: {
      organizationId: string;
      onAdd: (binding: PendingBinding) => void;
    }) => (
      <button
        type="button"
        data-testid="stub-add-binding"
        onClick={() =>
          onAdd({
            roleValue: "MEMBER",
            role: "MEMBER",
            customRoleId: undefined,
            customRoleName: undefined,
            scopeType: RoleBindingScopeType.TEAM,
            scopeId: "team-1",
            scopeName: "Team One",
          })
        }
      >
        Stage binding
      </button>
    ),
  };
});

const { MemberDetailDialog } = await import("../MemberDetailDialog");

const Wrapper = ({ children }: { children?: ReactNode }) => (
  <ChakraProvider value={defaultSystem}>{children}</ChakraProvider>
);

const baseMember = {
  userId: "user-1",
  role: OrganizationUserRole.MEMBER,
  user: { name: "Sergio", email: "sergio@example.com" },
};

function renderDialog(
  overrides: Partial<React.ComponentProps<typeof MemberDetailDialog>> = {},
) {
  return render(
    <MemberDetailDialog
      member={baseMember}
      organizationId="org-1"
      canManage={true}
      isCurrentUser={false}
      open={true}
      onClose={overrides.onClose ?? vi.fn()}
      {...overrides}
    />,
    { wrapper: Wrapper },
  );
}

describe("<MemberDetailDialog/>", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockListForUserData.current = [];
    mockListForMemberData.current = [];
    mockUpdateMemberRole.mockResolvedValue(undefined);
    mockApplyMemberBindings.mockResolvedValue(undefined);
  });

  afterEach(() => {
    cleanup();
  });

  describe("when the current user has organization:manage and is not viewing themselves", () => {
    it("renders the organization role field", () => {
      renderDialog();
      expect(screen.getByTestId("org-role-field")).toBeTruthy();
    });

    it("does not show the self-guard message", () => {
      renderDialog();
      expect(
        screen.queryByText(/cannot change your own organization role/i),
      ).toBeNull();
    });
  });

  describe("when the current user is viewing their own record", () => {
    it("shows the self-guard message instead of the role field", () => {
      renderDialog({ isCurrentUser: true });
      expect(
        screen.getByText(/cannot change your own organization role/i),
      ).toBeTruthy();
      expect(screen.queryByTestId("org-role-field")).toBeNull();
    });
  });

  describe("when the current user lacks organization:manage", () => {
    it("hides the organization role section entirely", () => {
      renderDialog({ canManage: false });
      expect(screen.queryByTestId("org-role-field")).toBeNull();
      expect(screen.queryByText("Organization role")).toBeNull();
    });

    it("does not render the footer save action", () => {
      renderDialog({ canManage: false });
      expect(screen.queryByRole("button", { name: /^save$/i })).toBeNull();
    });
  });

  describe("when saving after only the organization role changed", () => {
    it("calls updateMemberRole with the new role and does not call applyMemberBindings", async () => {
      renderDialog();

      fireEvent.click(screen.getByTestId("org-role-field"));
      fireEvent.click(screen.getByRole("button", { name: /^save$/i }));

      await vi.waitFor(() => {
        expect(mockUpdateMemberRole).toHaveBeenCalledTimes(1);
      });
      expect(mockUpdateMemberRole).toHaveBeenCalledWith({
        organizationId: "org-1",
        userId: "user-1",
        role: OrganizationUserRole.EXTERNAL,
      });
      expect(mockApplyMemberBindings).not.toHaveBeenCalled();
    });
  });

  describe("when saving after only bindings changed", () => {
    it("calls applyMemberBindings with the staged additions and does not call updateMemberRole", async () => {
      renderDialog();

      fireEvent.click(screen.getByTestId("stub-add-binding"));
      fireEvent.click(screen.getByRole("button", { name: /^save$/i }));

      await vi.waitFor(() => {
        expect(mockApplyMemberBindings).toHaveBeenCalledTimes(1);
      });
      expect(mockApplyMemberBindings).toHaveBeenCalledWith({
        organizationId: "org-1",
        userId: "user-1",
        bindingIdsToDelete: [],
        bindingsToCreate: [
          {
            role: "MEMBER",
            customRoleId: undefined,
            scopeType: RoleBindingScopeType.TEAM,
            scopeId: "team-1",
          },
        ],
      });
      expect(mockUpdateMemberRole).not.toHaveBeenCalled();
    });

    it("sends the existing binding id as a deletion when the user marks it for removal", async () => {
      mockListForUserData.current = [
        {
          id: "binding-1",
          role: "MEMBER",
          customRoleName: null,
          scopeType: RoleBindingScopeType.TEAM,
          scopeId: "team-1",
          scopeName: "Team One",
        },
      ];

      renderDialog();

      fireEvent.click(
        screen.getByRole("button", { name: /remove binding/i }),
      );
      fireEvent.click(screen.getByRole("button", { name: /^save$/i }));

      await vi.waitFor(() => {
        expect(mockApplyMemberBindings).toHaveBeenCalledTimes(1);
      });
      const firstCall = mockApplyMemberBindings.mock.calls[0];
      expect(firstCall?.[0]).toMatchObject({
        bindingIdsToDelete: ["binding-1"],
        bindingsToCreate: [],
      });
    });
  });

  describe("when saving after both the role and bindings changed", () => {
    it("calls updateMemberRole first, then applyMemberBindings", async () => {
      const callOrder: string[] = [];
      mockUpdateMemberRole.mockImplementation(async () => {
        callOrder.push("role");
      });
      mockApplyMemberBindings.mockImplementation(async () => {
        callOrder.push("bindings");
      });

      renderDialog();

      fireEvent.click(screen.getByTestId("org-role-field"));
      fireEvent.click(screen.getByTestId("stub-add-binding"));
      fireEvent.click(screen.getByRole("button", { name: /^save$/i }));

      await vi.waitFor(() => {
        expect(mockApplyMemberBindings).toHaveBeenCalledTimes(1);
      });
      expect(callOrder).toEqual(["role", "bindings"]);
    });

    it("does not run the binding batch when the role update fails", async () => {
      mockUpdateMemberRole.mockRejectedValueOnce(new Error("plan limit"));

      renderDialog();

      fireEvent.click(screen.getByTestId("org-role-field"));
      fireEvent.click(screen.getByTestId("stub-add-binding"));
      fireEvent.click(screen.getByRole("button", { name: /^save$/i }));

      await vi.waitFor(() => {
        expect(mockToasterCreate).toHaveBeenCalledWith(
          expect.objectContaining({ title: "plan limit", type: "error" }),
        );
      });
      expect(mockApplyMemberBindings).not.toHaveBeenCalled();
    });
  });

  describe("when the user clicks Cancel", () => {
    it("closes without firing any mutations", () => {
      const onClose = vi.fn();
      renderDialog({ onClose });

      fireEvent.click(screen.getByTestId("org-role-field"));
      fireEvent.click(screen.getByRole("button", { name: /cancel/i }));

      expect(onClose).toHaveBeenCalledTimes(1);
      expect(mockUpdateMemberRole).not.toHaveBeenCalled();
      expect(mockApplyMemberBindings).not.toHaveBeenCalled();
    });
  });

  describe("when no changes are pending", () => {
    it("leaves the Save button disabled", () => {
      renderDialog();
      const save = screen.getByRole("button", { name: /^save$/i });
      expect(save.hasAttribute("disabled")).toBe(true);
    });
  });
});
