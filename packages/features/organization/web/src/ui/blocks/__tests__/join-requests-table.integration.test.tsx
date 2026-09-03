/**
 * @vitest-environment jsdom
 *
 * The members area's join-requests panel (D12).
 *
 * Spec: specs/identity/join-requests.feature
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { InvitesTable } from "../invites-table";
import {
  JoinRequestsTable,
  type PendingJoinRequest,
} from "../join-requests-table";

const samsRequest: PendingJoinRequest = {
  joinRequestId: "jreq_1",
  name: "Sam Rivera",
  domain: "acme.com",
  requestedAt: new Date("2026-08-20T09:00:00Z"),
  expiresAt: new Date("2026-09-03T09:00:00Z"),
};

const renderPanel = (
  requests: PendingJoinRequest[],
  { isAdmin = true }: { isAdmin?: boolean } = {},
) => {
  const onApprove = vi.fn();
  const onReject = vi.fn();
  const result = render(
    <ChakraProvider value={defaultSystem}>
      <JoinRequestsTable
        requests={requests}
        isAdmin={isAdmin}
        answeringId={null}
        onApprove={onApprove}
        onReject={onReject}
      />
    </ChakraProvider>,
  );
  return { ...result, onApprove, onReject };
};

describe("given an organization with a pending request", () => {
  afterEach(() => cleanup());

  describe("when an administrator opens the members area", () => {
    /** @scenario Requests wait beside invitations in the members area */
    it("shows the request beside the invitations, with who asked and when", () => {
      render(
        <ChakraProvider value={defaultSystem}>
          <JoinRequestsTable
            requests={[samsRequest]}
            isAdmin
            answeringId={null}
            onApprove={vi.fn()}
            onReject={vi.fn()}
          />
          <InvitesTable
            invites={
              [
                {
                  id: "inv_1",
                  email: "dana@acme.com",
                  role: "MEMBER",
                  displayStatus: "PENDING",
                  expiresAt: new Date("2026-09-03T09:00:00Z"),
                  inviteCode: "code_1",
                  teamIds: "",
                },
              ] as never
            }
            isAdmin
            teams={[]}
            onViewInviteLink={vi.fn()}
            onResendInvite={vi.fn()}
            onRevokeInvite={vi.fn()}
          />
        </ChakraProvider>,
      );

      // Both directions, one place: somebody reaching in and the organization
      // reaching out.
      expect(screen.getByText("Requests to join")).toBeInTheDocument();
      expect(screen.getByText("Invites")).toBeInTheDocument();

      // Who is asking, and when they asked. The date is matched loosely on
      // purpose: it is rendered in the reader's own locale, and pinning one
      // spelling here would assert the test runner's locale rather than the
      // behaviour.
      expect(screen.getByText("Sam Rivera")).toBeInTheDocument();
      expect(screen.getByText("acme.com")).toBeInTheDocument();
      const row = screen.getByTestId("join-request-row");
      expect(row.textContent).toMatch(/Aug/);
      expect(row.textContent).toMatch(/20/);
      expect(row.textContent).toMatch(/2026/);
    });

    it("never shows the requester's address, only the domain that matched", () => {
      const { container } = renderPanel([samsRequest]);

      expect(container.textContent).not.toContain("sam@");
      expect(screen.getByText("acme.com")).toBeInTheDocument();
    });
  });

  describe("when the administrator approves", () => {
    /** @scenario Approval never carries a role choice */
    it("offers one approve action and no role picker at all", async () => {
      const { onApprove } = renderPanel([samsRequest]);

      // An approval grants the default role. An admin who wants to hand over
      // more sends a formal invitation, which is the flow that owns roles.
      expect(screen.queryByRole("combobox")).toBeNull();
      expect(screen.queryByText(/admin/i)).toBeNull();

      await userEvent.click(screen.getByRole("button", { name: "Approve" }));
      expect(onApprove).toHaveBeenCalledWith("jreq_1");
    });
  });

  describe("when the administrator rejects", () => {
    /** @scenario A rejection ends the request without asking for a reason */
    it("rejects in one click, with nowhere to type a reason", async () => {
      const { onReject } = renderPanel([samsRequest]);

      expect(screen.queryByRole("textbox")).toBeNull();

      await userEvent.click(screen.getByRole("button", { name: "Reject" }));
      expect(onReject).toHaveBeenCalledWith("jreq_1");
    });
  });
});

describe("given a member who cannot invite colleagues", () => {
  afterEach(() => cleanup());

  describe("when they open the members area", () => {
    /** @scenario Answering a request needs the authority that already gates inviting */
    it("shows no approve or reject action", () => {
      renderPanel([samsRequest], { isAdmin: false });

      // The server refuses them too — `organization:manage` is the same
      // permission that gates inviting, and no new one was invented.
      expect(screen.queryByRole("button", { name: "Approve" })).toBeNull();
      expect(screen.queryByRole("button", { name: "Reject" })).toBeNull();
      expect(screen.getByText("Sam Rivera")).toBeInTheDocument();
    });
  });
});

describe("given nothing is waiting", () => {
  afterEach(() => cleanup());

  describe("when the members area renders", () => {
    /** @scenario With the flag off nothing here exists */
    it("renders no panel at all", () => {
      // The flag being off looks exactly like this from the browser: the
      // procedure answers an empty list and the section does not appear.
      const { container } = renderPanel([]);

      expect(container.innerHTML).toBe("");
    });
  });
});
