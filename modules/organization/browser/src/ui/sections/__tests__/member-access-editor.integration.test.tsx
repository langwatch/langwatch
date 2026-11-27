import { GrantScopeTier } from "@langwatch/authz-contract";
/**
 * @vitest-environment jsdom
 *
 * The person drawer's access editor: role/assignment visibility, the staged save, and Cancel.
 * Spec: specs/members/member-access-editing.feature
 */
import { DesignSystemProvider } from "@langwatch/design-system/provider";
import type { SeatRoleOfferKind, SeatRoleOfferProps } from "@langwatch/enterprise-billing-client";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import type * as reactModule from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { BILLING_ONLY_SEAT } from "../../../model/member-invite-form.ts";
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
  mockInvalidateActivePlan,
  mockRecordBlocked,
  mockToasterCreate,
  mockMemberGrantsData,
  mockListForMemberData,
  mockNextSeat,
  mockChangeWithSeat,
  mockCompleteChange,
  mockUsageData,
  mockPendingChange,
  mockOfferKind,
} = vi.hoisted(() => ({
  mockChangeWithSeat: vi.fn(),
  mockCompleteChange: vi.fn(),
  // Seat usage as limits.getUsage answers it; undefined reads as unknown, which offers nothing.
  mockUsageData: { current: undefined as unknown },
  mockPendingChange: { current: null as unknown },
  // What billing's lent seat offer reports, as the stub below reports it.
  mockOfferKind: { current: "charge" as string },
  mockUpdateMemberRole: vi.fn(),
  mockApplyMemberGrants: vi.fn(),
  mockInvalidateListMemberGrants: vi.fn().mockResolvedValue(undefined),
  mockInvalidateListManagedGrants: vi.fn().mockResolvedValue(undefined),
  mockInvalidateOrgWithMembers: vi.fn().mockResolvedValue(undefined),
  mockInvalidateGetAll: vi.fn().mockResolvedValue(undefined),
  mockInvalidateGetMemberById: vi.fn().mockResolvedValue(undefined),
  mockInvalidateGetUsage: vi.fn().mockResolvedValue(undefined),
  mockInvalidateActivePlan: vi.fn().mockResolvedValue(undefined),
  mockRecordBlocked: vi.fn().mockResolvedValue({ recorded: true }),
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
  // The seat the stubbed seat selector picks when clicked.
  mockNextSeat: { current: "EXTERNAL" as string },
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
        pendingSeatRoleChange: { invalidate: () => Promise.resolve() },
        listHeldSeats: { invalidate: () => Promise.resolve() },
      },
      limits: { getUsage: { invalidate: mockInvalidateGetUsage } },
      plan: { getActivePlan: { invalidate: mockInvalidateActivePlan } },
      licenseEnforcement: {
        checkLimit: { invalidate: () => Promise.resolve() },
        checkAllLimits: { invalidate: () => Promise.resolve() },
      },
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
      getMemberById: {
        useQuery: () => ({ data: { user: { name: "Sam", email: "sam@acme.test" } } }),
      },
      changeMemberRoleWithSeat: {
        useMutation: () => ({ mutateAsync: mockChangeWithSeat }),
      },
      completeSeatRoleChange: {
        useMutation: () => ({ mutateAsync: mockCompleteChange }),
      },
      recordBlockedRoleChange: {
        useMutation: () => ({ mutateAsync: mockRecordBlocked }),
      },
      pendingSeatRoleChange: {
        useQuery: () => ({ data: mockPendingChange.current }),
      },
    },
    limits: {
      getUsage: { useQuery: () => ({ data: mockUsageData.current }) },
    },
  },
}));

vi.mock("../../../behavior/use-organization-team-project.ts", () => ({
  useOrganizationTeamProject: () => ({
    organization: { id: "org-1", name: "ACME", teams: [] },
    project: undefined,
  }),
}));

// Billing's lent offer is billing's to test; this stub reports a kind and confirms a quote.
vi.mock("../../../behavior/lent-seat-role-offer.tsx", async () => {
  const React = await vi.importActual<typeof reactModule>("react");
  return {
    SeatRoleOffer: (props: SeatRoleOfferProps) => {
      const { onKind, onAmountDue } = props;
      React.useEffect(() => {
        onKind?.(mockOfferKind.current as SeatRoleOfferKind);
        if (mockOfferKind.current === "charge") onAmountDue?.("$5.19");
      }, [onKind, onAmountDue]);
      return (
        <div
          data-testid="seat-role-offer"
          data-state={props.state}
          data-role={props.roleLabel}
          data-current-role={props.currentRoleLabel}
        >
          <button type="button" onClick={() => props.onConfirm(1_700_000_000_000)}>
            Buy the seat
          </button>
        </div>
      );
    },
  };
});

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

vi.mock("../../elements/organization-user-role-field.tsx", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  OrganizationUserRoleField: ({
    value,
    onChange,
    roles,
    disabled,
  }: {
    value: OrganizationUserRole;
    onChange: (role: OrganizationUserRole) => void;
    roles?: readonly string[];
    disabled?: boolean;
  }) => (
    <button
      type="button"
      disabled={disabled}
      data-testid="org-role-field"
      data-value={value}
      data-roles={roles?.join(",")}
      onClick={() => onChange(mockNextSeat.current as OrganizationUserRole)}
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
      disabled,
    }: {
      organizationId: string;
      onAdd: (grant: PendingGrant) => void;
      onReadyChange?: (isReady: boolean) => void;
      organizationRole?: OrganizationUserRole;
      disabled?: boolean;
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
        <button
          type="button"
          data-testid="stub-add-binding"
          disabled={disabled}
          onClick={() => onAdd(STUB_GRANT)}
        >
          Stage grant
        </button>
        <button
          type="button"
          data-testid="stub-add-custom-binding"
          disabled={disabled}
          onClick={() => onAdd(STUB_CUSTOM_GRANT)}
        >
          Stage custom grant
        </button>
        <button
          type="button"
          data-testid="stub-fill-draft"
          disabled={disabled}
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
  <DesignSystemProvider forcedTheme="light">{children}</DesignSystemProvider>
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
    mockNextSeat.current = OrganizationUserRole.EXTERNAL;
    mockUpdateMemberRole.mockResolvedValue({
      success: true,
      teamsLeftWithoutAdmin: [],
    });
    mockApplyMemberGrants.mockResolvedValue(undefined);
    mockUsageData.current = undefined;
    mockPendingChange.current = null;
    mockOfferKind.current = "charge";
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

  describe("given access rows were staged before the seat changed", () => {
    describe("when the admin picks a Developer seat", () => {
      beforeEach(() => {
        mockNextSeat.current = OrganizationUserRole.DEVELOPER;
      });

      /** @scenario The access dialog offers no shared access once the seat is Developer */
      it("replaces the access input row with the Developer notice", () => {
        renderEditor();

        expect(screen.getByTestId("stub-add-binding")).toBeTruthy();
        expect(screen.queryByTestId("developer-no-access")).toBeNull();

        fireEvent.click(screen.getByTestId("org-role-field"));

        expect(screen.getByTestId("developer-no-access").textContent).toContain(
          "A Developer seat works in its own project only",
        );
        expect(screen.queryByTestId("stub-add-binding")).toBeNull();
      });

      /** @scenario The access dialog offers no shared access once the seat is Developer */
      it("drops every staged row", () => {
        renderEditor();

        fireEvent.click(screen.getByTestId("stub-add-custom-binding"));
        expect(screen.getByText("Data Scientist")).toBeTruthy();

        fireEvent.click(screen.getByTestId("org-role-field"));

        expect(screen.queryByText("Data Scientist")).toBeNull();
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

  describe("given a Billing-only member", () => {
    /** @scenario "A role change clears Billing only and the new role is metered" */
    it("shows Billing only as their seat and says it reaches no team or project", () => {
      renderEditor({ memberRole: OrganizationUserRole.EXTERNAL, memberBillingOnly: true });

      expect(screen.getByTestId("org-role-field").getAttribute("data-value")).toBe(
        BILLING_ONLY_SEAT,
      );
      expect(screen.getByTestId("org-role-field").getAttribute("data-roles")).toContain(
        BILLING_ONLY_SEAT,
      );
      expect(screen.getByTestId("billing-only-no-access")).toBeTruthy();
    });

    /** @scenario "A role change clears Billing only and the new role is metered" */
    it("saves a move to a Lite Member seat as a role change", async () => {
      renderEditor({ memberRole: OrganizationUserRole.EXTERNAL, memberBillingOnly: true });

      fireEvent.click(screen.getByTestId("org-role-field"));
      fireEvent.click(screen.getByRole("button", { name: /^save$/i }));

      await vi.waitFor(() => {
        expect(mockUpdateMemberRole).toHaveBeenCalledWith({
          organizationId: "org-1",
          userId: "user-1",
          role: OrganizationUserRole.EXTERNAL,
        });
      });
    });
    describe("when the admin stages a grant on a Lite Member seat, then picks Billing only again", () => {
      /** @scenario "A Billing-only member is given no team, project or personal workspace" */
      it("drops the staged grant and leaves nothing to save", () => {
        renderEditor({ memberRole: OrganizationUserRole.EXTERNAL, memberBillingOnly: true });

        fireEvent.click(screen.getByTestId("org-role-field"));
        fireEvent.click(screen.getByTestId("stub-add-binding"));
        expect(screen.getByRole("button", { name: /^save$/i })).not.toBeDisabled();

        mockNextSeat.current = BILLING_ONLY_SEAT;
        fireEvent.click(screen.getByTestId("org-role-field"));

        expect(screen.getByTestId("billing-only-no-access")).toBeTruthy();
        expect(screen.getByRole("button", { name: /^save$/i })).toBeDisabled();
      });
    });
  });

  describe("given a member who is not Billing only", () => {
    it("does not offer Billing only as a seat", () => {
      renderEditor();

      expect(screen.getByTestId("org-role-field").getAttribute("data-roles")).not.toContain(
        BILLING_ONLY_SEAT,
      );
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

  describe("when the drawer opens the same member in another organization", () => {
    /** @scenario "Access rows that do not save after the paid role change are named" */
    it("drops the rows staged in the first organization", () => {
      const view = renderEditor();
      fireEvent.click(screen.getByTestId("stub-add-binding"));
      expect(screen.getByRole("button", { name: /undo add/i })).toBeTruthy();

      view.rerender(
        <MemberAccessEditor
          organizationId="org-2"
          userId="user-1"
          memberRole={OrganizationUserRole.MEMBER}
          canManage={true}
          isCurrentUser={false}
        />,
      );

      expect(screen.queryByRole("button", { name: /undo add/i })).toBeNull();
      expect(screen.getByRole("button", { name: /^save$/i })).toBeDisabled();
    });
  });

  describe("when a failed save answers after the admin left and reopened the member", () => {
    /** @scenario "Access rows that do not save after the paid role change are named" */
    it("stages nothing again in the new visit", async () => {
      let refuse: (error: Error) => void = () => {};
      mockApplyMemberGrants.mockImplementationOnce(
        () => new Promise((_resolve, reject) => (refuse = reject)),
      );
      const props = {
        memberRole: OrganizationUserRole.MEMBER,
        canManage: true,
        isCurrentUser: false,
      };
      const view = renderEditor();
      fireEvent.click(screen.getByTestId("stub-fill-draft"));
      fireEvent.click(screen.getByRole("button", { name: /^save$/i }));
      await vi.waitFor(() => expect(mockApplyMemberGrants).toHaveBeenCalledTimes(1));

      view.rerender(<MemberAccessEditor organizationId="org-1" userId="user-2" {...props} />);
      view.rerender(<MemberAccessEditor organizationId="org-1" userId="user-1" {...props} />);
      refuse(new Error("boom"));

      await vi.waitFor(() => {
        expect(mockToasterCreate).toHaveBeenCalledWith(expect.objectContaining({ type: "error" }));
      });
      expect(screen.queryByRole("button", { name: /undo add/i })).toBeNull();
      expect(screen.getByRole("button", { name: /^save$/i })).toBeDisabled();
    });
  });

  describe("when no changes are pending", () => {
    it("leaves the Save button disabled", () => {
      renderEditor();
      const save = screen.getByRole("button", { name: /^save$/i });
      expect(save.hasAttribute("disabled")).toBe(true);
    });
  });

  describe("given a Lite Member and every full seat in use", () => {
    const fullSeatsTaken = {
      membersCount: 2,
      membersLiteCount: 1,
      membersDeveloperCount: 0,
      activePlan: { type: "GROWTH_SEAT_USAGE" },
      seatLimitInfo: {
        status: "ok",
        members: { current: 2, max: 2, exceeded: false },
        membersLite: { current: 1, max: 100, exceeded: false },
        message: "",
      },
    };
    const renderLite = () => renderEditor({ memberRole: OrganizationUserRole.EXTERNAL });
    const pickAdmin = () => {
      mockNextSeat.current = OrganizationUserRole.ADMIN;
      fireEvent.click(screen.getByTestId("org-role-field"));
    };

    beforeEach(() => {
      mockUsageData.current = fullSeatsTaken;
    });

    /** @scenario "The offer appears under the role when no full seat is free" */
    it("offers the seat under the role field and drops Save", () => {
      renderLite();
      expect(screen.queryByTestId("seat-role-offer")).toBeNull();

      pickAdmin();

      const offer = screen.getByTestId("seat-role-offer");
      expect(offer.getAttribute("data-role")).toBe("Admin");
      expect(offer.getAttribute("data-current-role")).toBe("Lite Member");
      expect(screen.queryByRole("button", { name: /^save$/i })).toBeNull();
      expect(screen.getByRole("button", { name: /cancel/i })).toBeTruthy();
    });

    /** @scenario "A plan on custom terms points to support for the seat" */
    it("drops Save while the plan's seats are changed by our team", async () => {
      mockOfferKind.current = "support";
      renderLite();
      pickAdmin();

      await vi.waitFor(() => {
        expect(screen.queryByRole("button", { name: /^save$/i })).toBeNull();
      });
      expect(screen.getByTestId("seat-role-offer")).toBeTruthy();
      expect(screen.getByRole("button", { name: /cancel/i })).toBeTruthy();
    });

    it("offers nothing while a full seat is free", () => {
      mockUsageData.current = {
        ...fullSeatsTaken,
        seatLimitInfo: {
          ...fullSeatsTaken.seatLimitInfo,
          members: { current: 1, max: 2, exceeded: false },
        },
      };
      renderLite();
      pickAdmin();
      expect(screen.queryByTestId("seat-role-offer")).toBeNull();
      expect(screen.getByRole("button", { name: /^save$/i })).toBeTruthy();
    });

    /** @scenario "A plan without paid seats keeps Save" */
    it("keeps Save when the plan has no paid seats", () => {
      mockOfferKind.current = "none";
      renderLite();
      pickAdmin();
      expect(screen.getByRole("button", { name: /^save$/i })).not.toBeDisabled();
    });

    /** @scenario "One click adds the seat and changes the role" */
    it("buys the seat and changes the role in one click", async () => {
      mockChangeWithSeat.mockResolvedValue({
        status: "changed",
        seatAdded: true,
        teamsLeftWithoutAdmin: [],
      });
      renderLite();
      pickAdmin();

      fireEvent.click(screen.getByRole("button", { name: "Buy the seat" }));

      await vi.waitFor(() => {
        expect(screen.getByTestId("seat-role-offer").getAttribute("data-state")).toBe("done");
      });
      expect(mockChangeWithSeat).toHaveBeenCalledWith({
        organizationId: "org-1",
        userId: "user-1",
        role: OrganizationUserRole.ADMIN,
        quotedAt: 1_700_000_000_000,
      });
      expect(mockUpdateMemberRole).not.toHaveBeenCalled();
      await vi.waitFor(() => {
        expect(mockToasterCreate).toHaveBeenCalledWith(
          expect.objectContaining({
            title: "Sam is now an Admin",
            description: "1 seat added, $5.19 paid.",
            type: "success",
          }),
        );
      });
      expect(mockInvalidateGetUsage).toHaveBeenCalled();
    });

    /** @scenario "A seat bought for a refused role saves none of the staged access rows" */
    it("saves no staged access row when only the seat was bought", async () => {
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
      mockChangeWithSeat.mockResolvedValue({ status: "seat_only", reason: "the role was refused" });
      renderLite();
      fireEvent.click(screen.getByRole("button", { name: /remove assignment/i }));
      pickAdmin();

      fireEvent.click(screen.getByRole("button", { name: "Buy the seat" }));

      await vi.waitFor(() => {
        expect(mockInvalidateGetUsage).toHaveBeenCalled();
      });
      expect(mockApplyMemberGrants).not.toHaveBeenCalled();
    });

    /** @scenario "Access rows that do not save after the paid role change are named" */
    it("names access rows that did not save and still says the role changed", async () => {
      mockChangeWithSeat.mockResolvedValue({
        status: "changed",
        seatAdded: true,
        teamsLeftWithoutAdmin: [],
      });
      mockApplyMemberGrants.mockRejectedValueOnce(new Error("boom"));
      renderLite();
      fireEvent.click(screen.getByTestId("stub-add-binding"));
      pickAdmin();

      fireEvent.click(screen.getByRole("button", { name: "Buy the seat" }));

      await vi.waitFor(() => {
        expect(mockToasterCreate).toHaveBeenCalledWith(
          expect.objectContaining({
            title: "The role changed, but the access rows did not save",
            type: "error",
          }),
        );
      });
      expect(mockApplyMemberGrants).toHaveBeenCalledTimes(1);
      expect(mockToasterCreate).toHaveBeenCalledWith(
        expect.objectContaining({ title: "Sam is now an Admin", type: "success" }),
      );
    });

    /** @scenario "Access rows that do not save after the paid role change are named" */
    it("keeps the rows that did not save through the role refresh, so Save retries them", async () => {
      mockChangeWithSeat.mockResolvedValue({
        status: "changed",
        seatAdded: true,
        teamsLeftWithoutAdmin: [],
      });
      mockApplyMemberGrants.mockRejectedValueOnce(new Error("boom"));
      const view = renderLite();
      fireEvent.click(screen.getByTestId("stub-add-binding"));
      pickAdmin();
      fireEvent.click(screen.getByRole("button", { name: "Buy the seat" }));
      await vi.waitFor(() => {
        expect(mockToasterCreate).toHaveBeenCalledWith(
          expect.objectContaining({ title: "The role changed, but the access rows did not save" }),
        );
      });
      const failedBatch = mockApplyMemberGrants.mock.calls[0]![0];

      // The refreshed member now reads as the Admin the paid change made them.
      view.rerender(
        <MemberAccessEditor
          organizationId="org-1"
          userId="user-1"
          memberRole={OrganizationUserRole.ADMIN}
          canManage={true}
          isCurrentUser={false}
        />,
      );
      const save = await screen.findByRole("button", { name: /^save$/i });
      await vi.waitFor(() => expect(save).not.toBeDisabled());
      fireEvent.click(save);

      await vi.waitFor(() => expect(mockApplyMemberGrants).toHaveBeenCalledTimes(2));
      expect(mockApplyMemberGrants.mock.calls[1]![0]).toEqual(failedBatch);
      expect(mockUpdateMemberRole).not.toHaveBeenCalled();
      // The saved rows leave the staging, so nothing is left to save twice.
      await vi.waitFor(() => {
        expect(screen.queryByRole("button", { name: /undo add/i })).toBeNull();
        expect(save).toBeDisabled();
      });
    });

    /** @scenario "Access rows that do not save after the paid role change are named" */
    it("never stages a closed member's failed draft on the member opened next", async () => {
      mockChangeWithSeat.mockResolvedValue({
        status: "changed",
        seatAdded: true,
        teamsLeftWithoutAdmin: [],
      });
      let failBatch: () => void = () => {};
      mockApplyMemberGrants.mockReturnValueOnce(
        new Promise<void>((_, reject) => {
          failBatch = () => reject(new Error("boom"));
        }),
      );
      const view = renderLite();
      fireEvent.click(screen.getByTestId("stub-fill-draft"));
      pickAdmin();
      fireEvent.click(screen.getByRole("button", { name: "Buy the seat" }));
      await vi.waitFor(() => expect(mockApplyMemberGrants).toHaveBeenCalledTimes(1));

      view.rerender(
        <MemberAccessEditor
          organizationId="org-1"
          userId="user-2"
          memberRole={OrganizationUserRole.MEMBER}
          canManage={true}
          isCurrentUser={false}
        />,
      );
      await act(async () => failBatch());

      expect(screen.queryByRole("button", { name: /undo add/i })).toBeNull();
      expect(screen.getByRole("button", { name: /^save$/i })).toBeDisabled();
      expect(mockApplyMemberGrants).toHaveBeenCalledTimes(1);
    });

    /** @scenario "Access rows that do not save after the paid role change are named" */
    it("never stages a failed draft on the same member opened in another organization", async () => {
      mockChangeWithSeat.mockResolvedValue({
        status: "changed",
        seatAdded: true,
        teamsLeftWithoutAdmin: [],
      });
      let failBatch: () => void = () => {};
      mockApplyMemberGrants.mockReturnValueOnce(
        new Promise<void>((_, reject) => {
          failBatch = () => reject(new Error("boom"));
        }),
      );
      const view = renderLite();
      fireEvent.click(screen.getByTestId("stub-fill-draft"));
      pickAdmin();
      fireEvent.click(screen.getByRole("button", { name: "Buy the seat" }));
      await vi.waitFor(() => expect(mockApplyMemberGrants).toHaveBeenCalledTimes(1));

      view.rerender(
        <MemberAccessEditor
          organizationId="org-2"
          userId="user-1"
          memberRole={OrganizationUserRole.EXTERNAL}
          canManage={true}
          isCurrentUser={false}
        />,
      );
      await act(async () => failBatch());

      expect(screen.queryByRole("button", { name: /undo add/i })).toBeNull();
      expect(mockApplyMemberGrants).toHaveBeenCalledTimes(1);
    });

    /** @scenario "One click adds the seat and changes the role" */
    it("holds the role and the access rows as they stand while the paid change is sent", async () => {
      mockMemberGrantsData.current = [
        {
          id: "grant-1",
          role: "VIEWER",
          customRoleId: null,
          customRoleName: null,
          scopeType: GrantScopeTier.TEAM,
          scopeId: "team-9",
          scopeName: "Team Nine",
        },
      ];
      let answer: (value: unknown) => void = () => {};
      mockChangeWithSeat.mockReturnValueOnce(
        new Promise((resolve) => {
          answer = resolve;
        }),
      );
      renderLite();
      fireEvent.click(screen.getByTestId("stub-add-binding"));
      pickAdmin();
      fireEvent.click(screen.getByRole("button", { name: "Buy the seat" }));

      expect(screen.getByTestId("org-role-field")).toBeDisabled();
      expect(screen.getByTestId("stub-add-binding")).toBeDisabled();
      expect(screen.getByTestId("stub-fill-draft")).toBeDisabled();
      expect(screen.getByRole("button", { name: /undo add/i })).toBeDisabled();
      expect(screen.getByRole("button", { name: /remove assignment/i })).toBeDisabled();
      expect(screen.getByRole("button", { name: /cancel/i })).toBeDisabled();

      await act(async () =>
        answer({ status: "changed", seatAdded: true, teamsLeftWithoutAdmin: [] }),
      );
      await vi.waitFor(() => expect(screen.getByTestId("org-role-field")).not.toBeDisabled());
    });

    /** @scenario "One click adds the seat and changes the role" */
    it("keeps Save unavailable while the paid change saves its staged access rows", async () => {
      mockChangeWithSeat.mockResolvedValue({
        status: "changed",
        seatAdded: true,
        teamsLeftWithoutAdmin: [],
      });
      let settleBatch: () => void = () => {};
      mockApplyMemberGrants.mockReturnValueOnce(
        new Promise<void>((resolve) => {
          settleBatch = resolve;
        }),
      );
      renderLite();
      fireEvent.click(screen.getByTestId("stub-add-binding"));
      pickAdmin();
      fireEvent.click(screen.getByRole("button", { name: "Buy the seat" }));

      await vi.waitFor(() => expect(mockApplyMemberGrants).toHaveBeenCalledTimes(1));
      expect(screen.getByRole("button", { name: /^save$/i })).toBeDisabled();

      await act(async () => settleBatch());
      expect(mockApplyMemberGrants).toHaveBeenCalledTimes(1);
    });

    /** @scenario "A payment the customer must finish waits, then applies" */
    it("waits in the drawer with a new-tab payment link, then applies when it is paid", async () => {
      mockChangeWithSeat.mockResolvedValue({
        status: "payment_required",
        changeId: "change-1",
        url: "https://pay.example.test/invoice",
      });
      mockCompleteChange.mockResolvedValue({ status: "waiting", reason: null });
      renderLite();
      pickAdmin();

      fireEvent.click(screen.getByRole("button", { name: "Buy the seat" }));

      await vi.waitFor(() => {
        expect(screen.getByTestId("seat-role-waiting")).toBeTruthy();
      });
      expect(screen.getByText("Waiting for the seat payment.")).toBeTruthy();
      expect(screen.getByText("Sam becomes Admin as soon as it is paid.")).toBeTruthy();
      const pay = screen.getByRole("link", { name: "Finish paying on Stripe" });
      expect(pay.getAttribute("href")).toBe("https://pay.example.test/invoice");
      expect(pay.getAttribute("target")).toBe("_blank");
      expect(pay.getAttribute("rel")).toBe("noopener");

      // The batch goes as the admin left it, so nothing it holds can change while it waits.
      expect(screen.getByTestId("org-role-field")).toBeDisabled();
      expect(screen.getByTestId("stub-add-binding")).toBeDisabled();

      // The admin comes back once while the first ask is still out; that ask says waiting.
      let answerFirst: (value: unknown) => void = () => {};
      mockCompleteChange.mockReturnValueOnce(
        new Promise((resolve) => {
          answerFirst = resolve;
        }),
      );
      mockCompleteChange.mockResolvedValue({ status: "applied", reason: null });
      fireEvent.focus(window);
      fireEvent.focus(window);
      expect(mockCompleteChange).toHaveBeenCalledTimes(1);
      await act(async () => answerFirst({ status: "waiting", reason: null }));

      // The return during that ask is not lost: the editor asks again by itself.
      await vi.waitFor(() => {
        expect(screen.getByTestId("seat-role-offer").getAttribute("data-state")).toBe("done");
      });
      expect(mockCompleteChange).toHaveBeenCalledTimes(2);
      expect(mockCompleteChange).toHaveBeenCalledWith({
        organizationId: "org-1",
        changeId: "change-1",
      });
      await vi.waitFor(
        () => {
          expect(mockToasterCreate).toHaveBeenCalledWith(
            expect.objectContaining({ title: "Sam is now an Admin", type: "success" }),
          );
        },
        { timeout: 5000 },
      );
    });

    /** @scenario "A reopened drawer resumes a change waiting on its payment" */
    it("resumes a change still waiting on its payment", () => {
      mockPendingChange.current = {
        changeId: "change-1",
        role: OrganizationUserRole.ADMIN,
        url: "https://pay.example.test/invoice",
        status: "waiting",
        reason: null,
      };
      mockCompleteChange.mockResolvedValue({ status: "waiting", reason: null });
      renderLite();
      expect(screen.getByTestId("seat-role-waiting")).toBeTruthy();
      // The paid change is the one in flight, so the ordinary Save cannot race it.
      expect(screen.queryByRole("button", { name: /^save$/i })).toBeNull();
    });

    describe("when the drawer moves to another member before the change answers", () => {
      it("keeps the earlier member's payment out of the next member's drawer", async () => {
        let answer: (value: unknown) => void = () => {};
        mockChangeWithSeat.mockReturnValue(
          new Promise((resolve) => {
            answer = resolve;
          }),
        );
        const view = renderLite();
        pickAdmin();
        fireEvent.click(screen.getByRole("button", { name: "Buy the seat" }));

        view.rerender(
          <MemberAccessEditor
            organizationId="org-1"
            userId="user-2"
            memberRole={OrganizationUserRole.EXTERNAL}
            canManage={true}
            isCurrentUser={false}
          />,
        );
        expect(mockChangeWithSeat).toHaveBeenCalledTimes(1);
        // Answered inside act, so React has applied the late answer before the assertion.
        await act(async () => {
          answer({
            status: "payment_required",
            changeId: "change-1",
            url: "https://pay.example.test/a",
          });
        });

        expect(screen.queryByTestId("seat-role-waiting")).toBeNull();
      });
    });

    /** @scenario "A failed payment changes nothing" */
    it("says nothing changed when the payment fails, and offers the seat again", async () => {
      mockPendingChange.current = {
        changeId: "change-1",
        role: OrganizationUserRole.ADMIN,
        url: "https://pay.example.test/invoice",
        status: "waiting",
        reason: null,
      };
      mockCompleteChange.mockResolvedValue({ status: "failed", reason: null });
      renderLite();

      fireEvent.focus(window);

      await vi.waitFor(() => {
        expect(
          screen.getByText(
            "The payment didn't go through, so nothing changed. Sam is still a Lite Member.",
          ),
        ).toBeTruthy();
      });
      expect(screen.getByTestId("seat-role-offer").getAttribute("data-state")).toBe("offer");
    });

    /** @scenario "A bought seat refreshes the seat counts and says so once" */
    it("re-reads the seat counts and the plan's caps, then toasts once", async () => {
      mockChangeWithSeat.mockResolvedValue({
        status: "changed",
        seatAdded: true,
        teamsLeftWithoutAdmin: [],
      });
      renderLite();
      pickAdmin();

      fireEvent.click(screen.getByRole("button", { name: "Buy the seat" }));

      await vi.waitFor(() => {
        expect(mockToasterCreate).toHaveBeenCalledTimes(1);
      });
      expect(mockInvalidateGetUsage).toHaveBeenCalled();
      expect(mockInvalidateActivePlan).toHaveBeenCalled();
      expect(mockInvalidateOrgWithMembers).toHaveBeenCalled();
      expect(mockToasterCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "Sam is now an Admin",
          description: "1 seat added, $5.19 paid.",
          type: "success",
        }),
      );
    });

    /** @scenario "A bought seat refreshes the seat counts and says so once" */
    it("still toasts when re-reading the counts fails", async () => {
      mockInvalidateGetUsage.mockRejectedValueOnce(new Error("network"));
      mockChangeWithSeat.mockResolvedValue({
        status: "changed",
        seatAdded: true,
        teamsLeftWithoutAdmin: [],
      });
      renderLite();
      pickAdmin();

      fireEvent.click(screen.getByRole("button", { name: "Buy the seat" }));

      await vi.waitFor(() => {
        expect(mockToasterCreate).toHaveBeenCalledWith(
          expect.objectContaining({ title: "Sam is now an Admin", type: "success" }),
        );
      });
    });

    /** @scenario "A bought seat refreshes the seat counts and says so once" */
    it("re-reads the counts once a waiting change applies, and toasts once", async () => {
      mockPendingChange.current = {
        changeId: "change-1",
        role: OrganizationUserRole.ADMIN,
        url: "https://pay.example.test/invoice",
        status: "waiting",
        reason: null,
      };
      mockCompleteChange.mockResolvedValue({ status: "applied", reason: null });
      renderLite();

      await vi.waitFor(
        () => {
          fireEvent.focus(window);
          expect(mockToasterCreate).toHaveBeenCalled();
        },
        { timeout: 5000 },
      );
      fireEvent.focus(window);
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(mockToasterCreate).toHaveBeenCalledTimes(1);
      expect(mockInvalidateActivePlan).toHaveBeenCalled();
    });

    /** @scenario "A bought seat refreshes the seat counts and says so once" */
    it("re-reads the counts when the seat was paid but the role refused", async () => {
      mockPendingChange.current = {
        changeId: "change-1",
        role: OrganizationUserRole.ADMIN,
        url: "https://pay.example.test/invoice",
        status: "waiting",
        reason: null,
      };
      mockCompleteChange.mockResolvedValue({ status: "seat_only", reason: "Refused." });
      renderLite();

      await vi.waitFor(
        () => {
          fireEvent.focus(window);
          expect(mockInvalidateActivePlan).toHaveBeenCalled();
        },
        { timeout: 5000 },
      );
      expect(mockToasterCreate).not.toHaveBeenCalled();
    });

    /** @scenario "A paid seat whose role change was refused says so in the drawer" */
    it("says the seat was added and paid but the role was not changed, with the reason", async () => {
      mockPendingChange.current = {
        changeId: "change-1",
        role: OrganizationUserRole.ADMIN,
        url: "https://pay.example.test/invoice",
        status: "waiting",
        reason: null,
      };
      mockCompleteChange.mockResolvedValue({
        status: "seat_only",
        reason: "This member is the last admin.",
      });
      renderLite();

      fireEvent.focus(window);

      await vi.waitFor(() => {
        expect(screen.getByTestId("seat-role-seat-only")).toBeTruthy();
      });
      expect(
        screen.getByText(
          "1 seat added and paid, but Sam's role could not be changed: this member is the last admin.",
        ),
      ).toBeTruthy();
      expect(screen.getByText("The seat is free for anyone.")).toBeTruthy();
    });

    /** @scenario "Stuck billing shows the calm state with Contact support" */
    it("shows the calm state and puts the role field back when billing is held", async () => {
      mockChangeWithSeat.mockRejectedValue({
        data: { error: { code: "subscription_ambiguous", httpStatus: 409, meta: {} } },
      });
      renderLite();
      pickAdmin();

      fireEvent.click(screen.getByRole("button", { name: "Buy the seat" }));

      await vi.waitFor(() => {
        expect(screen.getByTestId("seat-role-offer").getAttribute("data-state")).toBe("stuck");
      });
      expect(screen.getByTestId("org-role-field").getAttribute("data-value")).toBe(
        OrganizationUserRole.EXTERNAL,
      );
      expect(mockToasterCreate).not.toHaveBeenCalled();
    });

    /** @scenario "A seat offer refused for two live subscriptions is kept for the admin" */
    it("shows the calm state as soon as the offer is refused and keeps the attempt once", async () => {
      mockOfferKind.current = "blocked";
      renderLite();
      pickAdmin();

      await vi.waitFor(() => {
        expect(screen.getByTestId("seat-role-offer").getAttribute("data-state")).toBe("stuck");
      });
      expect(screen.getByTestId("org-role-field").getAttribute("data-value")).toBe(
        OrganizationUserRole.EXTERNAL,
      );
      expect(mockRecordBlocked).toHaveBeenCalledWith({
        organizationId: "org-1",
        userId: "user-1",
        role: OrganizationUserRole.ADMIN,
      });

      pickAdmin();
      await vi.waitFor(() => {
        expect(screen.getByTestId("seat-role-offer").getAttribute("data-state")).toBe("stuck");
      });
      expect(mockRecordBlocked).toHaveBeenCalledTimes(1);
      expect(mockChangeWithSeat).not.toHaveBeenCalled();
      expect(mockToasterCreate).not.toHaveBeenCalled();
    });

    it("toasts any other refusal and leaves the offer in place", async () => {
      mockChangeWithSeat.mockRejectedValue(new Error("boom"));
      renderLite();
      pickAdmin();

      fireEvent.click(screen.getByRole("button", { name: "Buy the seat" }));

      await vi.waitFor(() => {
        expect(mockToasterCreate).toHaveBeenCalledWith(
          expect.objectContaining({ title: "Couldn't update this member", type: "error" }),
        );
      });
      expect(screen.getByTestId("seat-role-offer").getAttribute("data-state")).toBe("offer");
    });
  });
});
