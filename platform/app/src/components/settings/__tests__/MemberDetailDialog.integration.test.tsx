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
  mockInvalidateListForOrg,
  mockInvalidateOrgWithMembers,
  mockInvalidateGetAll,
  mockInvalidateGetUsage,
  mockToasterCreate,
  mockListForUserData,
  mockListForMemberData,
} = vi.hoisted(() => ({
  mockUpdateMemberRole: vi.fn(),
  mockApplyMemberBindings: vi.fn(),
  mockInvalidateListForUser: vi.fn().mockResolvedValue(undefined),
  mockInvalidateListForOrg: vi.fn().mockResolvedValue(undefined),
  mockInvalidateOrgWithMembers: vi.fn().mockResolvedValue(undefined),
  mockInvalidateGetAll: vi.fn().mockResolvedValue(undefined),
  mockInvalidateGetUsage: vi.fn().mockResolvedValue(undefined),
  mockToasterCreate: vi.fn(),
  mockListForUserData: {
    current: [] as Array<{
      id: string;
      role: string;
      customRoleId: string | null;
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
        listForOrg: { invalidate: mockInvalidateListForOrg },
      },
      organization: {
        getOrganizationWithMembersAndTheirTeams: {
          invalidate: mockInvalidateOrgWithMembers,
        },
        getAll: { invalidate: mockInvalidateGetAll },
      },
      limits: { getUsage: { invalidate: mockInvalidateGetUsage } },
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
  const actual = await vi.importActual<
    typeof import("../GroupBindingInputRow")
  >("../GroupBindingInputRow");
  const React = await vi.importActual<typeof import("react")>("react");

  const STUB_BINDING: PendingBinding = {
    roleValue: "MEMBER",
    role: "MEMBER",
    customRoleId: undefined,
    customRoleName: undefined,
    scopeType: RoleBindingScopeType.TEAM,
    scopeId: "team-1",
    scopeName: "Team One",
  };

  // Mirrors the real row's two paths: Add commits the draft, while a filled
  // but never-added draft reports readiness and hands itself over on flush.
  const BindingInputRow = React.forwardRef(function StubBindingInputRow(
    {
      onAdd,
      onReadyChange,
    }: {
      organizationId: string;
      onAdd: (binding: PendingBinding) => void;
      onReadyChange?: (isReady: boolean) => void;
    },
    ref: React.Ref<{ flush: () => PendingBinding | null }>,
  ) {
    const isFilled = React.useRef(false);
    React.useImperativeHandle(ref, () => ({
      flush: () => {
        if (!isFilled.current) return null;
        isFilled.current = false;
        return STUB_BINDING;
      },
    }));
    return (
      <>
        <button
          type="button"
          data-testid="stub-add-binding"
          onClick={() => onAdd(STUB_BINDING)}
        >
          Stage binding
        </button>
        <button
          type="button"
          data-testid="stub-fill-draft"
          onClick={() => {
            isFilled.current = true;
            onReadyChange?.(true);
          }}
        >
          Fill draft
        </button>
      </>
    );
  });

  return {
    ...actual,
    BindingInputRow,
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
    mockUpdateMemberRole.mockResolvedValue({
      success: true,
      teamsLeftWithoutAdmin: [],
    });
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

  describe("given the server answers without the affected-teams field", () => {
    beforeEach(() => {
      // A rollout window: this build reads a field an older server does not
      // send, and by the time it reads it the save has already happened.
      // Telling somebody their successful save failed is the worse outcome, so
      // the field is optional to the client even though it is not to the API.
      mockUpdateMemberRole.mockResolvedValue({ success: true });
    });

    describe("when the organization role is saved", () => {
      it("still reports the save as done", async () => {
        renderDialog();

        fireEvent.click(screen.getByTestId("org-role-field"));
        fireEvent.click(screen.getByRole("button", { name: /^save$/i }));

        await vi.waitFor(() => {
          expect(mockToasterCreate).toHaveBeenCalled();
        });
        const toast = mockToasterCreate.mock.calls.at(-1)?.[0];
        expect(toast).toMatchObject({
          title: "Member updated",
          type: "success",
        });
        // Nothing to disclose, so nothing is claimed about any team.
        expect(toast?.description).toBeUndefined();
      });
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
          customRoleId: null,
          customRoleName: null,
          scopeType: RoleBindingScopeType.TEAM,
          scopeId: "team-1",
          scopeName: "Team One",
        },
      ];

      renderDialog();

      fireEvent.click(screen.getByRole("button", { name: /remove binding/i }));
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

      // The headline names the action, not the rejection: since #5984 an
      // error's message is the code slug for a handled failure, so the raw
      // string this used to assert on would read `validation_error` to the
      // customer. `showErrorToast` renders the caller's copy instead.
      await vi.waitFor(() => {
        expect(mockToasterCreate).toHaveBeenCalledWith(
          expect.objectContaining({
            title: "Couldn't update this member",
            type: "error",
          }),
        );
      });
      expect(mockApplyMemberBindings).not.toHaveBeenCalled();
    });
  });

  describe("given the member already holds the staged access row", () => {
    beforeEach(() => {
      mockListForUserData.current = [
        {
          id: "binding-1",
          role: "MEMBER",
          customRoleId: null,
          customRoleName: null,
          scopeType: RoleBindingScopeType.TEAM,
          scopeId: "team-1",
          scopeName: "Team One",
        },
      ];
    });

    describe("when the admin stages it again", () => {
      /** @scenario An access row the member already holds appears once */
      it("keeps a single row for that access", () => {
        renderDialog();

        fireEvent.click(screen.getByTestId("stub-add-binding"));

        // A staged row would carry an "Undo add" action; the existing row is
        // the only one there.
        expect(screen.queryByRole("button", { name: /undo add/i })).toBeNull();
      });

      /** @scenario An access row the member already holds appears once */
      it("leaves nothing to save", () => {
        renderDialog();

        fireEvent.click(screen.getByTestId("stub-add-binding"));

        const save = screen.getByRole("button", { name: /^save$/i });
        expect(save.hasAttribute("disabled")).toBe(true);
      });
    });
  });

  describe("given the member holds the organization row their seat grants", () => {
    beforeEach(() => {
      mockListForUserData.current = [
        {
          id: "mirror-1",
          role: "MEMBER",
          customRoleId: null,
          customRoleName: null,
          scopeType: RoleBindingScopeType.ORGANIZATION,
          scopeId: "org-1",
          scopeName: "Acme",
        },
        {
          id: "extra-1",
          role: "VIEWER",
          customRoleId: null,
          customRoleName: null,
          scopeType: RoleBindingScopeType.ORGANIZATION,
          scopeId: "org-1",
          scopeName: "Acme",
        },
      ];
    });

    describe("when the admin looks for a way to remove it", () => {
      /** @scenario The seat's own organization access is changed through the seat selector */
      it("offers none on the mirror row, and keeps it on other organization rows", () => {
        renderDialog();

        // Only the off-seat VIEWER row is removable; the MEMBER row mirrors
        // the member's seat and is managed by the seat selector.
        expect(
          screen.getAllByRole("button", { name: /remove binding/i }),
        ).toHaveLength(1);
      });
    });
  });

  describe("when the same access row is staged twice", () => {
    /** @scenario An access row the member already holds appears once */
    it("keeps a single staged row", () => {
      renderDialog();

      fireEvent.click(screen.getByTestId("stub-add-binding"));
      fireEvent.click(screen.getByTestId("stub-add-binding"));

      expect(screen.getAllByRole("button", { name: /undo add/i })).toHaveLength(
        1,
      );
    });
  });

  describe("when a complete access row was filled in but never added", () => {
    /** @scenario A picked access row saves without pressing Add */
    it("enables Save and includes the row in the save", async () => {
      renderDialog();

      const save = screen.getByRole("button", { name: /^save$/i });
      expect(save.hasAttribute("disabled")).toBe(true);

      fireEvent.click(screen.getByTestId("stub-fill-draft"));
      expect(save.hasAttribute("disabled")).toBe(false);

      fireEvent.click(save);

      await vi.waitFor(() => {
        expect(mockApplyMemberBindings).toHaveBeenCalledTimes(1);
      });
      expect(mockApplyMemberBindings.mock.calls[0]?.[0]).toMatchObject({
        bindingsToCreate: [
          {
            role: "MEMBER",
            scopeType: RoleBindingScopeType.TEAM,
            scopeId: "team-1",
          },
        ],
      });
    });
  });

  describe("given the access batch fails after the seat change landed", () => {
    beforeEach(() => {
      mockApplyMemberBindings.mockRejectedValue(new Error("boom"));
    });

    describe("when the admin saves both changes", () => {
      /** @scenario A failed save shows the member's access as it now is */
      it("re-reads the member's access instead of trusting the staged view", async () => {
        renderDialog();

        fireEvent.click(screen.getByTestId("org-role-field"));
        fireEvent.click(screen.getByTestId("stub-add-binding"));
        fireEvent.click(screen.getByRole("button", { name: /^save$/i }));

        await vi.waitFor(() => {
          expect(mockToasterCreate).toHaveBeenCalledWith(
            expect.objectContaining({
              title: "Couldn't update this member",
              type: "error",
            }),
          );
        });
        // The seat change landed before the failure, so what the dialog shows
        // must come from the server, not from the staged rows.
        expect(mockUpdateMemberRole).toHaveBeenCalledTimes(1);
        expect(mockInvalidateListForUser).toHaveBeenCalled();
        expect(mockInvalidateOrgWithMembers).toHaveBeenCalled();
        expect(mockInvalidateGetUsage).toHaveBeenCalled();
      });
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
