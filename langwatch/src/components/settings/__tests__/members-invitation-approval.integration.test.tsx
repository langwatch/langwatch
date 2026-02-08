/**
 * @vitest-environment jsdom
 *
 * Unit tests for invitation approval workflow on the members page.
 *
 * Covers the @unit scenarios from specs/members/update-pending-invitation.feature:
 * - Non-admin user sees restricted role options in invite form
 * - Admin user sees all role options in invite form
 * - Non-admin sees no action buttons for pending requests
 * - Admin sees approve and reject buttons for pending requests
 */
import { cleanup, render, screen } from "@testing-library/react";
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { orgRoleOptions } from "../OrganizationUserRoleField";
import { getOrgRoleOptionsForUser } from "../../members/getOrgRoleOptionsForUser";
import {
  WaitingApprovalActions,
} from "../../members/WaitingApprovalActions";

const Wrapper = ({ children }: { children: React.ReactNode }) => (
  <ChakraProvider value={defaultSystem}>{children}</ChakraProvider>
);

describe("getOrgRoleOptionsForUser()", () => {
  describe("when user is a non-admin", () => {
    it("returns only Member and Lite Member options", () => {
      const options = getOrgRoleOptionsForUser({ isAdmin: false });

      const labels = options.map((o) => o.label);
      expect(labels).toContain("Member");
      expect(labels).toContain("Lite Member");
      expect(labels).toHaveLength(2);
    });

    it("does not include Admin as a role option", () => {
      const options = getOrgRoleOptionsForUser({ isAdmin: false });

      const labels = options.map((o) => o.label);
      expect(labels).not.toContain("Admin");
    });
  });

  describe("when user is an admin", () => {
    it("returns Admin, Member, and Lite Member options", () => {
      const options = getOrgRoleOptionsForUser({ isAdmin: true });

      const labels = options.map((o) => o.label);
      expect(labels).toContain("Admin");
      expect(labels).toContain("Member");
      expect(labels).toContain("Lite Member");
      expect(labels).toHaveLength(3);
    });
  });
});

describe("<WaitingApprovalActions/>", () => {
  afterEach(() => {
    cleanup();
  });

  describe("when user is a non-admin", () => {
    it("does not display approve buttons", () => {
      render(
        <WaitingApprovalActions
          isAdmin={false}
          inviteId="inv-1"
          onApprove={vi.fn()}
          onReject={vi.fn()}
        />,
        { wrapper: Wrapper },
      );

      expect(screen.queryByRole("button", { name: /approve/i })).toBeNull();
    });

    it("does not display reject buttons", () => {
      render(
        <WaitingApprovalActions
          isAdmin={false}
          inviteId="inv-1"
          onApprove={vi.fn()}
          onReject={vi.fn()}
        />,
        { wrapper: Wrapper },
      );

      expect(screen.queryByRole("button", { name: /reject/i })).toBeNull();
    });
  });

  describe("when user is an admin", () => {
    it("displays an Approve button", () => {
      render(
        <WaitingApprovalActions
          isAdmin={true}
          inviteId="inv-1"
          onApprove={vi.fn()}
          onReject={vi.fn()}
        />,
        { wrapper: Wrapper },
      );

      expect(screen.getByRole("button", { name: /approve/i })).toBeTruthy();
    });

    it("displays a Reject button", () => {
      render(
        <WaitingApprovalActions
          isAdmin={true}
          inviteId="inv-1"
          onApprove={vi.fn()}
          onReject={vi.fn()}
        />,
        { wrapper: Wrapper },
      );

      expect(screen.getByRole("button", { name: /reject/i })).toBeTruthy();
    });
  });
});
