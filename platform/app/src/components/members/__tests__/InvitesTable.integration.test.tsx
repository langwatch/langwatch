/**
 * @vitest-environment jsdom
 *
 * Integration tests for the Invites table on the members page.
 *
 * Covers the visible invitation states of D11
 * (specs/identity/resilient-invitations.feature): every invitation shows its
 * state and expiry, an expired one offers resend, and a revoked one stays
 * visible with no actions.
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { INVITE_STATUS, OrganizationUserRole } from "~/generated/prisma/client";
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
    displayStatus: OrganizationInvite["displayStatus"];
  },
): OrganizationInvite {
  return {
    role: "MEMBER" as OrganizationUserRole,
    requestedBy: "user-1",
    requestedByUser: null,
    inviteCode: "invite-code",
    teamIds: "team-1",
    expiration: new Date(Date.now() + 86400000),
    ...overrides,
  } as OrganizationInvite;
}

function renderTable(
  invites: OrganizationInvite[],
  {
    isAdmin = true,
    onResendInvite = vi.fn<(inviteId: string) => void>(),
    onRevokeInvite = vi.fn<(inviteId: string) => void>(),
  }: {
    isAdmin?: boolean;
    onResendInvite?: (inviteId: string) => void;
    onRevokeInvite?: (inviteId: string) => void;
  } = {},
) {
  render(
    <InvitesTable
      invites={invites}
      isAdmin={isAdmin}
      teams={teams}
      onViewInviteLink={vi.fn()}
      onResendInvite={onResendInvite}
      onRevokeInvite={onRevokeInvite}
    />,
    { wrapper: Wrapper },
  );
}

describe("<InvitesTable/>", () => {
  afterEach(() => {
    cleanup();
  });

  describe("when invitations are in every visible state", () => {
    it("shows each invitation with its state badge", () => {
      renderTable([
        makeInvite({
          id: "inv-1",
          email: "live@example.com",
          status: "PENDING",
          displayStatus: "PENDING",
        }),
        makeInvite({
          id: "inv-2",
          email: "late@example.com",
          status: "PENDING",
          displayStatus: "EXPIRED",
          expiration: new Date(Date.now() - 1000),
        }),
        makeInvite({
          id: "inv-3",
          email: "gone@example.com",
          status: "REVOKED",
          displayStatus: "REVOKED",
        }),
      ]);

      expect(screen.getByText("Invited")).toBeTruthy();
      expect(screen.getByText("Expired")).toBeTruthy();
      expect(screen.getByText("Revoked")).toBeTruthy();
      expect(screen.getByText("gone@example.com")).toBeTruthy();
    });
  });

  describe("when an admin opens an expired invitation's actions", () => {
    it("offers resend, and resending calls back with the invite id", async () => {
      const onResendInvite = vi.fn();
      renderTable(
        [
          makeInvite({
            id: "inv-expired",
            email: "late@example.com",
            status: "PENDING",
            displayStatus: "EXPIRED",
            expiration: new Date(Date.now() - 1000),
          }),
        ],
        { onResendInvite },
      );

      fireEvent.click(screen.getByLabelText("Invite actions"));
      fireEvent.click(await screen.findByText("Resend invitation"));

      expect(onResendInvite).toHaveBeenCalledWith("inv-expired");
    });
  });

  describe("when an invitation is revoked", () => {
    it("stays visible but offers no actions", () => {
      renderTable([
        makeInvite({
          id: "inv-revoked",
          email: "gone@example.com",
          status: "REVOKED",
          displayStatus: "REVOKED",
        }),
      ]);

      expect(screen.getByText("gone@example.com")).toBeTruthy();
      expect(screen.queryByLabelText("Invite actions")).toBeNull();
    });
  });

  describe("when the viewer is not an admin", () => {
    it("offers neither resend nor revoke", async () => {
      renderTable(
        [
          makeInvite({
            id: "inv-view",
            email: "live@example.com",
            status: "PENDING",
            displayStatus: "PENDING",
          }),
        ],
        { isAdmin: false },
      );

      fireEvent.click(screen.getByLabelText("Invite actions"));
      // The menu did open — the link item proves it — so the absences below
      // are real absences, not an unopened menu.
      await screen.findByText("View invite link");
      expect(screen.queryByText("Resend invitation")).toBeNull();
      expect(screen.queryByText("Revoke")).toBeNull();
    });
  });
});
