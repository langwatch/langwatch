/**
 * @vitest-environment jsdom
 *
 * Integration tests for the Pending Approval section on the members page.
 *
 * Covers the @integration UI scenarios from specs/members/update-pending-invitation.feature:
 * - Non-admin sees only their own pending approval requests
 * - Admin sees all pending approval requests
 * - Pending approval requests display the requester name
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { INVITE_STATUS, OrganizationUserRole } from "@prisma/client";
import {
  PendingApprovalSection,
  type WaitingApprovalInvite,
} from "../PendingApprovalSection";

const Wrapper = ({ children }: { children: React.ReactNode }) => (
  <ChakraProvider value={defaultSystem}>{children}</ChakraProvider>
);

function makeInvite(
  overrides: Partial<WaitingApprovalInvite> & {
    id: string;
    email: string;
  },
): WaitingApprovalInvite {
  return {
    role: "MEMBER" as OrganizationUserRole,
    status: "WAITING_APPROVAL" as INVITE_STATUS,
    requestedBy: null,
    requestedByUser: null,
    ...overrides,
  };
}

const currentUserId = "user-1";

const invitesFromMultipleUsers: WaitingApprovalInvite[] = [
  makeInvite({
    id: "inv-1",
    email: "alice-invite@example.com",
    requestedBy: "user-1",
    requestedByUser: { id: "user-1", name: "Alice", email: "alice@example.com" },
  }),
  makeInvite({
    id: "inv-2",
    email: "bob-invite@example.com",
    requestedBy: "user-2",
    requestedByUser: { id: "user-2", name: "Bob", email: "bob@example.com" },
  }),
  makeInvite({
    id: "inv-3",
    email: "charlie-invite@example.com",
    requestedBy: "user-1",
    requestedByUser: { id: "user-1", name: "Alice", email: "alice@example.com" },
  }),
];

describe("<PendingApprovalSection/>", () => {
  afterEach(() => {
    cleanup();
  });

  describe("when user is a non-admin", () => {
    it("shows only requests created by the current user", () => {
      render(
        <PendingApprovalSection
          invites={invitesFromMultipleUsers}
          isAdmin={false}
          currentUserId={currentUserId}
          onApprove={vi.fn()}
          onReject={vi.fn()}
        />,
        { wrapper: Wrapper },
      );

      // user-1 created inv-1 and inv-3
      expect(screen.getByText("alice-invite@example.com")).toBeTruthy();
      expect(screen.getByText("charlie-invite@example.com")).toBeTruthy();
      // user-2 created inv-2 -- should not be visible
      expect(screen.queryByText("bob-invite@example.com")).toBeNull();
    });
  });

  describe("when user is an admin", () => {
    it("shows all pending approval requests", () => {
      render(
        <PendingApprovalSection
          invites={invitesFromMultipleUsers}
          isAdmin={true}
          currentUserId={currentUserId}
          onApprove={vi.fn()}
          onReject={vi.fn()}
        />,
        { wrapper: Wrapper },
      );

      expect(screen.getByText("alice-invite@example.com")).toBeTruthy();
      expect(screen.getByText("bob-invite@example.com")).toBeTruthy();
      expect(screen.getByText("charlie-invite@example.com")).toBeTruthy();
    });

    it("displays the requester name for each request", () => {
      const inviteFromAlice = makeInvite({
        id: "inv-10",
        email: "someone@example.com",
        requestedBy: "user-1",
        requestedByUser: { id: "user-1", name: "Alice", email: "alice@example.com" },
      });

      render(
        <PendingApprovalSection
          invites={[inviteFromAlice]}
          isAdmin={true}
          currentUserId="admin-user"
          onApprove={vi.fn()}
          onReject={vi.fn()}
        />,
        { wrapper: Wrapper },
      );

      expect(screen.getByText("Alice")).toBeTruthy();
    });
  });

  describe("when there are no pending approval requests", () => {
    it("renders nothing", () => {
      const { container } = render(
        <PendingApprovalSection
          invites={[]}
          isAdmin={true}
          currentUserId={currentUserId}
          onApprove={vi.fn()}
          onReject={vi.fn()}
        />,
        { wrapper: Wrapper },
      );

      expect(container.textContent).toBe("");
    });
  });
});
