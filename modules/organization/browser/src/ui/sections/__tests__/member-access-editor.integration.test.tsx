/**
 * @vitest-environment jsdom
 *
 * The person drawer's access editor: role/assignment visibility, the staged save, and Cancel.
 * Spec: specs/members/member-access-editing.feature
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { GrantScopeTier } from "@langwatch/authz-contract";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import type * as reactModule from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { OrganizationUserRole } from "../../../model/prisma-types.ts";
import type { PendingGrant } from "../group-grant-input-row.tsx";
import type * as groupGrantInputRowModule from "../group-grant-input-row.tsx";

const {
  mockUpdateMemberRole,
  mockApplyMemberGrants,
  mockInvalidateListMemberGrants,
  mockInvalidateListManagedGrants,
  mockInvalidateOrgWithMembers,
  mockInvalidateGetAll,
  mockInvalidateGetMemberById,
  mockInvalidateGetUsage,
  mockToasterCreate,
  mockMemberGrantsData,
  mockListForMemberData,
} = vi.hoisted(() => ({
  mockUpdateMemberRole: vi.fn(),
  mockApplyMemberGrants: vi.fn(),
  mockInvalidateListMemberGrants: vi.fn().mockResolvedValue(undefined),
  mockInvalidateListManagedGrants: vi.fn().mockResolvedValue(undefined),
  mockInvalidateOrgWithMembers: vi.fn().mockResolvedValue(undefined),
  mockInvalidateGetAll: vi.fn().mockResolvedValue(undefined),
  mockInvalidateGetMemberById: vi.fn().mockResolvedValue(undefined),
  mockInvalidateGetUsage: vi.fn().mockResolvedValue(undefined),
  mockToasterCreate: vi.fn(),
  mockMemberGrantsData: {
    current: [] as {
      id: string;
      role: string;
      customRoleId: string | null;
      customRoleName: string | null;
      scopeType: GrantScopeTier;
      scopeId: string;
      scopeName: string | null;
    }[],
  },
  mockListForMemberData: {
    current: [] as unknown[],
  },
}));

vi.mock("../../../behavior/organization-api.ts", () => ({
  api: {
    useUtils: () => ({
      authz: {
        listMemberGrants: { invalidate: mockInvalidateListMemberGrants },
        listManagedGrants: { invalidate: mockInvalidateListManagedGrants },
      },
      organization: {
        getOrganizationWithMembersAndTheirTeams: {
          invalidate: mockInvalidateOrgWithMembers,
        },
        getAll: { invalidate: mockInvalidateGetAll },
        getScopeGraph: { invalidate: () => Promise.resolve() },
        getMemberById: { invalidate: mockInvalidateGetMemberById },
      },
      limits: { getUsage: { invalidate: mockInvalidateGetUsage } },
    }),
    authz: {
      listMemberGrants: {
        useQuery: () => ({
          data: mockMemberGrantsData.current,
          isLoading: false,
          isError: false,
          error: null,
        }),
      },
      applyMemberGrants: {
        useMutation: () => ({ mutateAsync: mockApplyMemberGrants }),
      },
    },
    group: {
      listForMember: {
        useQuery: () => ({
          data: mockListForMemberData.current,
          isLoading: false,
          isError: false,
          error: null,
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

// The toaster and the error toast are the host port's `succeeded`/`failed` in
// this package, so what the editor says is asserted where it is composed. The
// two call SHAPES are what these tests are about, and they did not change.
vi.mock("../../../behavior/organization-feedback.ts", () => ({
  useOrganizationToaster: () => ({
    create: (...args: unknown[]) => mockToasterCreate(...args),
  }),
  useShowErrorToast:
    () =>
    ({ fallbackTitle }: { error: unknown; fallbackTitle?: string }) =>
      mockToasterCreate({ title: fallbackTitle, type: "error" }),
}));

vi.mock("../../elements/organization-user-role-field.tsx", () => ({
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

vi.mock("../group-grant-input-row.tsx", async () => {
  const actual = await vi.importActual<typeof groupGrantInputRowModule>("../group-grant-input-row");
  const React = await vi.importActual<typeof reactModule>("react");

  const STUB_GRANT: PendingGrant = {
    roleValue: "MEMBER",
    role: "MEMBER",
    customRoleId: undefined,
    customRoleName: undefined,
    scopeType: GrantScopeTier.TEAM,
    scopeId: "team-1",
    scopeName: "Team One",
  };

  const STUB_CUSTOM_GRANT: PendingGrant = {
    roleValue: "CUSTOM:role-1",
    role: "CUSTOM",
    customRoleId: "role-1",
    customRoleName: "Data Scientist",
    scopeType: GrantScopeTier.TEAM,
    scopeId: "team-2",
    scopeName: "Team Two",
  };

  // Mirrors the real row's two paths: Add commits the draft, while a filled
  // but never-added draft reports readiness and hands itself over on flush.
  // The seat prop is surfaced as text so tests can prove the editor passes
  // the live pending seat, not the member's stored one.
  const GrantInputRow = React.forwardRef(function StubGrantInputRow(
    {
      onAdd,
      onReadyChange,
      organizationRole,
    }: {
      organizationId: string;
      onAdd: (grant: PendingGrant) => void;
      onReadyChange?: (isReady: boolean) => void;
      organizationRole?: OrganizationUserRole;
    },
    ref: React.Ref<{ flush: () => PendingGrant | null }>,
  ) {
    const isFilled = React.useRef(false);
    React.useImperativeHandle(ref, () => ({
      flush: () => {
        if (!isFilled.current) return null;
        isFilled.current = false;
        return STUB_GRANT;
      },
    }));
    return (
      <>
        <span data-testid="stub-organization-role">{organizationRole}</span>
        <button type="button" data-testid="stub-add-binding" onClick={() => onAdd(STUB_GRANT)}>
          Stage grant
        </button>
        <button
          type="button"
          data-testid="stub-add-custom-binding"
          onClick={() => onAdd(STUB_CUSTOM_GRANT)}
        >
          Stage custom grant
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
    GrantInputRow,
  };
});

const { MemberAccessEditor } = await import("../member-access-editor.tsx");

const Wrapper = ({ children }: { children?: ReactNode }) => (
  <ChakraProvider value={defaultSystem}>{children}</ChakraProvider>
);

function renderEditor(overrides: Partial<React.ComponentProps<typeof MemberAccessEditor>> = {}) {
  return render(
    <MemberAccessEditor
      organizationId="org-1"
      userId="user-1"
      memberRole={OrganizationUserRole.MEMBER}
      canManage={true}
      isCurrentUser={false}
      {...overrides}
    />,
    { wrapper: Wrapper },
  );
}

describe("<MemberAccessEditor/>", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockMemberGrantsData.current = [];
    mockListForMemberData.current = [];
    mockUpdateMemberRole.mockResolvedValue({
      success: true,
      teamsLeftWithoutAdmin: [],
    });
    mockApplyMemberGrants.mockResolvedValue(undefined);
  });

  afterEach(() => {
    cleanup();
  });

  describe("when the current user has organization:manage and is not viewing themselves", () => {
    it("renders the organization role field", () => {
      renderEditor();
      expect(screen.getByTestId("org-role-field")).toBeTruthy();
    });

    it("does not show the self-guard message", () => {
      renderEditor();
      expect(screen.queryByText(/cannot change your own organization role/i)).toBeNull();
    });
  });

  describe("when the current user is viewing their own record", () => {
    it("shows the self-guard message instead of the role field", () => {
      renderEditor({ isCurrentUser: true });
      expect(screen.getByText(/cannot change your own organization role/i)).toBeTruthy();
      expect(screen.queryByTestId("org-role-field")).toBeNull();
    });
  });

  describe("when the current user lacks organization:manage", () => {
    it("hides the organization role section entirely", () => {
      renderEditor({ canManage: false });
      expect(screen.queryByTestId("org-role-field")).toBeNull();
      expect(screen.queryByText("Organization role")).toBeNull();
    });

    it("does not render the footer save action", () => {
      renderEditor({ canManage: false });
      expect(screen.queryByRole("button", { name: /^save$/i })).toBeNull();
    });
  });

  describe("when saving after only the organization role changed", () => {
    it("calls updateMemberRole with the new role and does not call applyMemberGrants", async () => {
      renderEditor();

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
      expect(mockApplyMemberGrants).not.toHaveBeenCalled();
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
        renderEditor();

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

  describe("when saving after only grants changed", () => {
    it("calls applyMemberGrants with the staged additions and does not call updateMemberRole", async () => {
      renderEditor();

      fireEvent.click(screen.getByTestId("stub-add-binding"));
      fireEvent.click(screen.getByRole("button", { name: /^save$/i }));

      await vi.waitFor(() => {
        expect(mockApplyMemberGrants).toHaveBeenCalledTimes(1);
      });
      expect(mockApplyMemberGrants).toHaveBeenCalledWith({
        organizationId: "org-1",
        userId: "user-1",
        bindingIdsToDelete: [],
        bindingsToCreate: [
          {
            role: "MEMBER",
            customRoleId: undefined,
            scopeType: GrantScopeTier.TEAM,
            scopeId: "team-1",
          },
        ],
      });
      expect(mockUpdateMemberRole).not.toHaveBeenCalled();
    });

    it("sends the existing grant id as a deletion when the user marks it for removal", async () => {
      mockMemberGrantsData.current = [
        {
          id: "grant-1",
          role: "MEMBER",
          customRoleId: null,
          customRoleName: null,
          scopeType: GrantScopeTier.TEAM,
          scopeId: "team-1",
          scopeName: "Team One",
        },
      ];

      renderEditor();

      fireEvent.click(screen.getByRole("button", { name: /remove assignment/i }));
      fireEvent.click(screen.getByRole("button", { name: /^save$/i }));

      await vi.waitFor(() => {
        expect(mockApplyMemberGrants).toHaveBeenCalledTimes(1);
      });
      const firstCall = mockApplyMemberGrants.mock.calls[0];
      expect(firstCall?.[0]).toMatchObject({
        bindingIdsToDelete: ["grant-1"],
        bindingsToCreate: [],
      });
    });
  });

  describe("when saving after both the role and grants changed", () => {
    it("calls updateMemberRole first, then applyMemberGrants", async () => {
      const callOrder: string[] = [];
      mockUpdateMemberRole.mockImplementation(async () => {
        callOrder.push("role");
      });
      mockApplyMemberGrants.mockImplementation(async () => {
        callOrder.push("grants");
      });

      renderEditor();

      fireEvent.click(screen.getByTestId("org-role-field"));
      fireEvent.click(screen.getByTestId("stub-add-binding"));
      fireEvent.click(screen.getByRole("button", { name: /^save$/i }));

      await vi.waitFor(() => {
        expect(mockApplyMemberGrants).toHaveBeenCalledTimes(1);
      });
      expect(callOrder).toEqual(["role", "grants"]);
    });

    it("does not run the grant batch when the role update fails", async () => {
      mockUpdateMemberRole.mockRejectedValueOnce(new Error("plan limit"));

      renderEditor();

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
      expect(mockApplyMemberGrants).not.toHaveBeenCalled();
    });
  });

  describe("given the member already holds the staged access row", () => {
    beforeEach(() => {
      mockMemberGrantsData.current = [
        {
          id: "grant-1",
          role: "MEMBER",
          customRoleId: null,
          customRoleName: null,
          scopeType: GrantScopeTier.TEAM,
          scopeId: "team-1",
          scopeName: "Team One",
        },
      ];
    });

    describe("when the admin stages it again", () => {
      /** @scenario An access row the member already holds appears once */
      it("keeps a single row for that access", () => {
        renderEditor();

        fireEvent.click(screen.getByTestId("stub-add-binding"));

        // A staged row would carry an "Undo add" action; the existing row is
        // the only one there.
        expect(screen.queryByRole("button", { name: /undo add/i })).toBeNull();
      });

      /** @scenario An access row the member already holds appears once */
      it("leaves nothing to save", () => {
        renderEditor();

        fireEvent.click(screen.getByTestId("stub-add-binding"));

        const save = screen.getByRole("button", { name: /^save$/i });
        expect(save.hasAttribute("disabled")).toBe(true);
      });
    });
  });

  describe("given the member holds the organization row their seat grants", () => {
    beforeEach(() => {
      mockMemberGrantsData.current = [
        {
          id: "mirror-1",
          role: "MEMBER",
          customRoleId: null,
          customRoleName: null,
          scopeType: GrantScopeTier.ORGANIZATION,
          scopeId: "org-1",
          scopeName: "Acme",
        },
        {
          id: "extra-1",
          role: "VIEWER",
          customRoleId: null,
          customRoleName: null,
          scopeType: GrantScopeTier.ORGANIZATION,
          scopeId: "org-1",
          scopeName: "Acme",
        },
      ];
    });

    describe("when the admin looks for a way to remove it", () => {
      /** @scenario The seat's own organization access is changed through the seat selector */
      it("offers none on the mirror row, and keeps it on other organization rows", () => {
        renderEditor();

        // Only the off-seat VIEWER row is removable; the MEMBER row mirrors
        // the member's seat and is managed by the seat selector.
        expect(screen.getAllByRole("button", { name: /remove assignment/i })).toHaveLength(1);
      });
    });
  });

  describe("when the same access row is staged twice", () => {
    /** @scenario An access row the member already holds appears once */
    it("keeps a single staged row", () => {
      renderEditor();

      fireEvent.click(screen.getByTestId("stub-add-binding"));
      fireEvent.click(screen.getByTestId("stub-add-binding"));

      expect(screen.getAllByRole("button", { name: /undo add/i })).toHaveLength(1);
    });
  });

  describe("when a complete access row was filled in but never added", () => {
    /** @scenario A picked access row saves without pressing Add */
    it("enables Save and includes the row in the save", async () => {
      renderEditor();

      const save = screen.getByRole("button", { name: /^save$/i });
      expect(save.hasAttribute("disabled")).toBe(true);

      fireEvent.click(screen.getByTestId("stub-fill-draft"));
      expect(save.hasAttribute("disabled")).toBe(false);

      fireEvent.click(save);

      await vi.waitFor(() => {
        expect(mockApplyMemberGrants).toHaveBeenCalledTimes(1);
      });
      expect(mockApplyMemberGrants.mock.calls[0]?.[0]).toMatchObject({
        bindingsToCreate: [
          {
            role: "MEMBER",
            scopeType: GrantScopeTier.TEAM,
            scopeId: "team-1",
          },
        ],
      });
    });
  });

  describe("given the access batch fails after the seat change landed", () => {
    beforeEach(() => {
      mockApplyMemberGrants.mockRejectedValue(new Error("boom"));
    });

    describe("when the admin saves both changes", () => {
      /** @scenario A failed save shows the member's access as it now is */
      it("re-reads the member's access instead of trusting the staged view", async () => {
        renderEditor();

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
        // The seat change landed before the failure, so what the editor shows
        // must come from the server, not from the staged rows.
        expect(mockUpdateMemberRole).toHaveBeenCalledTimes(1);
        expect(mockInvalidateListMemberGrants).toHaveBeenCalled();
        expect(mockInvalidateOrgWithMembers).toHaveBeenCalled();
        expect(mockInvalidateGetUsage).toHaveBeenCalled();
      });
    });
  });

  describe("when the seat selector switches to a Lite Member seat", () => {
    /** @scenario The dialog offers only the Viewer role for a member on a Lite Member seat */
    it("hands the live seat to the access input row", () => {
      renderEditor();

      expect(screen.getByTestId("stub-organization-role").textContent).toBe(
        OrganizationUserRole.MEMBER as string,
      );

      fireEvent.click(screen.getByTestId("org-role-field"));

      expect(screen.getByTestId("stub-organization-role").textContent).toBe(
        OrganizationUserRole.EXTERNAL as string,
      );
    });
  });

  describe("given access rows were staged before the seat changed", () => {
    describe("when the admin picks a Lite Member seat and saves", () => {
      /** @scenario Staged access rows correct to Viewer when the seat switches to Lite Member */
      it("saves every staged row as Viewer with no custom role", async () => {
        renderEditor();

        fireEvent.click(screen.getByTestId("stub-add-binding"));
        fireEvent.click(screen.getByTestId("stub-add-custom-binding"));
        fireEvent.click(screen.getByTestId("org-role-field"));
        fireEvent.click(screen.getByRole("button", { name: /^save$/i }));

        await vi.waitFor(() => {
          expect(mockApplyMemberGrants).toHaveBeenCalledTimes(1);
        });
        expect(mockApplyMemberGrants).toHaveBeenCalledWith({
          organizationId: "org-1",
          userId: "user-1",
          bindingIdsToDelete: [],
          bindingsToCreate: [
            {
              role: "VIEWER",
              customRoleId: undefined,
              scopeType: GrantScopeTier.TEAM,
              scopeId: "team-1",
            },
            {
              role: "VIEWER",
              customRoleId: undefined,
              scopeType: GrantScopeTier.TEAM,
              scopeId: "team-2",
            },
          ],
        });
      });

      /** @scenario Staged access rows correct to Viewer when the seat switches to Lite Member */
      it("shows the staged rows as Viewer before the save", () => {
        renderEditor();

        fireEvent.click(screen.getByTestId("stub-add-custom-binding"));
        expect(screen.getByText("Data Scientist")).toBeTruthy();

        fireEvent.click(screen.getByTestId("org-role-field"));

        expect(screen.queryByText("Data Scientist")).toBeNull();
        expect(screen.getByText("VIEWER")).toBeTruthy();
      });
    });
  });

  describe("given the member holds access above Viewer through a group", () => {
    beforeEach(() => {
      mockListForMemberData.current = [
        {
          id: "group-1",
          name: "Platform",
          grants: [
            {
              id: "gb-1",
              role: "ADMIN",
              customRoleId: null,
              customRoleName: null,
              scopeType: GrantScopeTier.TEAM,
              scopeId: "team-1",
              scopeName: "Team One",
            },
          ],
        },
      ];
    });

    /** @scenario Group access names the Lite Member ceiling on rows above Viewer */
    it("keeps the group's stored role and names the ceiling on a Lite Member seat", () => {
      renderEditor({ memberRole: OrganizationUserRole.EXTERNAL });

      expect(screen.getByText("ADMIN")).toBeTruthy();
      expect(screen.getByText("Applies as Viewer while on a Lite Member seat")).toBeTruthy();
    });

    /** @scenario Group access names the Lite Member ceiling on rows above Viewer */
    it("adds the note the moment a Lite Member seat is picked", () => {
      renderEditor();

      expect(screen.queryByText("Applies as Viewer while on a Lite Member seat")).toBeNull();

      fireEvent.click(screen.getByTestId("org-role-field"));

      expect(screen.getByText("Applies as Viewer while on a Lite Member seat")).toBeTruthy();
    });

    /** @scenario Group access names the Lite Member ceiling on rows above Viewer */
    it("leaves custom group roles unlabeled, their grant needs no correction", () => {
      mockListForMemberData.current = [
        {
          id: "group-1",
          name: "Platform",
          grants: [
            {
              id: "gb-2",
              role: "CUSTOM",
              customRoleId: "role-1",
              customRoleName: "Data Scientist",
              scopeType: GrantScopeTier.TEAM,
              scopeId: "team-1",
              scopeName: "Team One",
            },
          ],
        },
      ];

      renderEditor({ memberRole: OrganizationUserRole.EXTERNAL });

      expect(screen.getByText("Data Scientist")).toBeTruthy();
      expect(screen.queryByText("Applies as Viewer while on a Lite Member seat")).toBeNull();
    });
  });

  describe("when the user clicks Cancel", () => {
    it("puts the draft back without firing any mutations", () => {
      renderEditor();

      fireEvent.click(screen.getByTestId("org-role-field"));
      const save = screen.getByRole("button", { name: /^save$/i });
      expect(save.hasAttribute("disabled")).toBe(false);

      fireEvent.click(screen.getByRole("button", { name: /cancel/i }));

      expect(save.hasAttribute("disabled")).toBe(true);
      expect(mockUpdateMemberRole).not.toHaveBeenCalled();
      expect(mockApplyMemberGrants).not.toHaveBeenCalled();
    });
  });

  describe("when no changes are pending", () => {
    it("leaves the Save button disabled", () => {
      renderEditor();
      const save = screen.getByRole("button", { name: /^save$/i });
      expect(save.hasAttribute("disabled")).toBe(true);
    });
  });
});
