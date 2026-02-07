/**
 * @vitest-environment jsdom
 *
 * Integration tests for the Invites table on the members page.
 *
 * Covers the @integration UI scenarios from specs/members/update-pending-invitation.feature:
 * - Non-admin sees only their own pending approval requests
 * - Admin sees all pending approval requests
 * - Pending approval requests display a badge
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { INVITE_STATUS, OrganizationUserRole } from "@prisma/client";
import type { RouterOutputs } from "~/utils/api";
import { InvitesTable } from "../InvitesTable";

type OrganizationInvite =
  RouterOutputs["organization"]["getOrganizationPendingInvites"][number];

const Wrapper = ({ children }: { children: React.ReactNode }) => (
  <ChakraProvider value={defaultSystem}>{children}</ChakraProvider>
);

const teams = [{ id: "team-1", name: "Sandbox", slug: "sandbox" }];

function makeInvite(
  overrides: Partial<OrganizationInvite> & {
    id: string;
    email: string;
    status: INVITE_STATUS;
  },
): OrganizationInvite {
  return {
    role: "MEMBER" as OrganizationUserRole,
    requestedBy: "user-1",
    requestedByUser: null,
    inviteCode: "invite-code",
    teamIds: "team-1",
    ...overrides,
  } as OrganizationInvite;
}

describe("<InvitesTable/>", () => {
  afterEach(() => {
    cleanup();
  });

  describe("when user is a non-admin", () => {
    const currentUserId = "user-1";
    const waitingApprovalInvites: OrganizationInvite[] = [
      makeInvite({
        id: "inv-1",
        email: "alice-invite@example.com",
        status: "WAITING_APPROVAL",
        requestedBy: "user-1",
      }),
      makeInvite({
        id: "inv-2",
        email: "bob-invite@example.com",
        status: "WAITING_APPROVAL",
        requestedBy: "user-2",
      }),
    ];

    it("hides pending approval requests created by other users", () => {
      render(
        <InvitesTable
          waitingApprovalInvites={waitingApprovalInvites}
          sentInvites={[]}
          isAdmin={false}
          currentUserId={currentUserId}
          teams={teams}
          onApprove={vi.fn()}
          onReject={vi.fn()}
          onViewInviteLink={vi.fn()}
          onDeleteInvite={vi.fn()}
        />,
        { wrapper: Wrapper },
      );

      expect(screen.queryByText("bob-invite@example.com")).toBeNull();
    });

    it("shows pending approval requests created by the current user", () => {
      render(
        <InvitesTable
          waitingApprovalInvites={waitingApprovalInvites}
          sentInvites={[]}
          isAdmin={false}
          currentUserId={currentUserId}
          teams={teams}
          onApprove={vi.fn()}
          onReject={vi.fn()}
          onViewInviteLink={vi.fn()}
          onDeleteInvite={vi.fn()}
        />,
        { wrapper: Wrapper },
      );

      expect(screen.getByText("alice-invite@example.com")).toBeTruthy();
    });
  });

  describe("when user is an admin", () => {
    const waitingApprovalInvites: OrganizationInvite[] = [
      makeInvite({
        id: "inv-10",
        email: "admin-view@example.com",
        status: "WAITING_APPROVAL",
        requestedBy: "user-2",
      }),
    ];

    it("shows all pending approval requests", () => {
      render(
        <InvitesTable
          waitingApprovalInvites={waitingApprovalInvites}
          sentInvites={[]}
          isAdmin={true}
          currentUserId="admin-user"
          teams={teams}
          onApprove={vi.fn()}
          onReject={vi.fn()}
          onViewInviteLink={vi.fn()}
          onDeleteInvite={vi.fn()}
        />,
        { wrapper: Wrapper },
      );

      expect(screen.getByText("admin-view@example.com")).toBeTruthy();
    });

    it("shows approve actions for pending invites", () => {
      render(
        <InvitesTable
          waitingApprovalInvites={waitingApprovalInvites}
          sentInvites={[]}
          isAdmin={true}
          currentUserId="admin-user"
          teams={teams}
          onApprove={vi.fn()}
          onReject={vi.fn()}
          onViewInviteLink={vi.fn()}
          onDeleteInvite={vi.fn()}
        />,
        { wrapper: Wrapper },
      );

      expect(screen.getByRole("button", { name: "Approve" })).toBeTruthy();
    });

    it("shows reject actions for pending invites", () => {
      render(
        <InvitesTable
          waitingApprovalInvites={waitingApprovalInvites}
          sentInvites={[]}
          isAdmin={true}
          currentUserId="admin-user"
          teams={teams}
          onApprove={vi.fn()}
          onReject={vi.fn()}
          onViewInviteLink={vi.fn()}
          onDeleteInvite={vi.fn()}
        />,
        { wrapper: Wrapper },
      );

      expect(screen.getByRole("button", { name: "Reject" })).toBeTruthy();
    });
  });

  describe("when pending approval invites are shown", () => {
    it("displays a pending approval badge", () => {
      render(
        <InvitesTable
          waitingApprovalInvites={[
            makeInvite({
              id: "inv-20",
              email: "pending@example.com",
              status: "WAITING_APPROVAL",
            }),
          ]}
          sentInvites={[]}
          isAdmin={true}
          currentUserId="admin-user"
          teams={teams}
          onApprove={vi.fn()}
          onReject={vi.fn()}
          onViewInviteLink={vi.fn()}
          onDeleteInvite={vi.fn()}
        />,
        { wrapper: Wrapper },
      );

      expect(screen.getByText("Pending Approval")).toBeTruthy();
    });
  });

  describe("when sent invites are shown", () => {
    it("displays an invited badge", () => {
      render(
        <InvitesTable
          waitingApprovalInvites={[]}
          sentInvites={[
            makeInvite({
              id: "inv-21",
              email: "invited@example.com",
              status: "PENDING",
            }),
          ]}
          isAdmin={true}
          currentUserId="admin-user"
          teams={teams}
          onApprove={vi.fn()}
          onReject={vi.fn()}
          onViewInviteLink={vi.fn()}
          onDeleteInvite={vi.fn()}
        />,
        { wrapper: Wrapper },
      );

      expect(screen.getByText("Invited")).toBeTruthy();
    });
  });

  describe("when pending and sent invites are present", () => {
    const waitingApprovalInvites = [
      makeInvite({
        id: "inv-30",
        email: "pending@example.com",
        status: "WAITING_APPROVAL",
      }),
    ];
    const sentInvites = [
      makeInvite({
        id: "inv-31",
        email: "sent@example.com",
        status: "PENDING",
      }),
    ];

    it("renders pending invites before sent invites", () => {
      render(
        <InvitesTable
          waitingApprovalInvites={waitingApprovalInvites}
          sentInvites={sentInvites}
          isAdmin={true}
          currentUserId="admin-user"
          teams={teams}
          onApprove={vi.fn()}
          onReject={vi.fn()}
          onViewInviteLink={vi.fn()}
          onDeleteInvite={vi.fn()}
        />,
        { wrapper: Wrapper },
      );

      const rows = screen.getAllByRole("row").slice(1);

      expect(rows).toHaveLength(2);
      expect(within(rows[0]!).getByText("pending@example.com")).toBeTruthy();
    });

    it("renders sent invites after pending invites", () => {
      render(
        <InvitesTable
          waitingApprovalInvites={waitingApprovalInvites}
          sentInvites={sentInvites}
          isAdmin={true}
          currentUserId="admin-user"
          teams={teams}
          onApprove={vi.fn()}
          onReject={vi.fn()}
          onViewInviteLink={vi.fn()}
          onDeleteInvite={vi.fn()}
        />,
        { wrapper: Wrapper },
      );

      const rows = screen.getAllByRole("row").slice(1);

      expect(rows).toHaveLength(2);
      expect(within(rows[1]!).getByText("sent@example.com")).toBeTruthy();
    });
  });

  describe("when there are no invites", () => {
    it("renders nothing", () => {
      const { container } = render(
        <InvitesTable
          waitingApprovalInvites={[]}
          sentInvites={[]}
          isAdmin={true}
          currentUserId="admin-user"
          teams={teams}
          onApprove={vi.fn()}
          onReject={vi.fn()}
          onViewInviteLink={vi.fn()}
          onDeleteInvite={vi.fn()}
        />,
        { wrapper: Wrapper },
      );

      expect(container.textContent).toBe("");
    });
  });
});
