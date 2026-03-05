/**
 * @vitest-environment jsdom
 *
 * Integration tests for invitation approval workflow on the members page.
 *
 * Covers the @integration scenarios from specs/members/update-pending-invitation.feature:
 * - Non-admin sees no action buttons for pending requests
 * - Admin sees approve and reject buttons for pending requests
 *
 * Note: Unit tests for getOrgRoleOptionsForUser are in
 * src/components/members/__tests__/getOrgRoleOptionsForUser.unit.test.ts
 */
import { cleanup, render, screen } from "@testing-library/react";
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WaitingApprovalActions } from "../../members/WaitingApprovalActions";

const Wrapper = ({ children }: { children: React.ReactNode }) => (
  <ChakraProvider value={defaultSystem}>{children}</ChakraProvider>
);

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
