/**
 * @vitest-environment node
 * @see specs/identity/join-before-create.feature
 * The invitations waiting on an account, read by the addresses it has PROVED.
 */
import { describe, expect, it, vi } from "vitest";

import { OrganizationInvitationsService } from "../organization-invitations.service.ts";

function harness(answers: Record<string, { inviteCode: string; role: "MEMBER" | "DEVELOPER" }>) {
  const findOldestPendingInviteForAddress = vi.fn(async ({ address }: { address: string }) => {
    const hit = answers[address];
    return hit ? { ...hit, organizationName: "Acme", inviterName: "Dana" } : null;
  });
  // Partial double: the lookup reads only the repository's one member.
  const service = OrganizationInvitationsService.create({
    repository: { findOldestPendingInviteForAddress },
  } as never);
  return { service, findOldestPendingInviteForAddress };
}

describe("OrganizationInvitationsService.findPendingForAddresses()", () => {
  describe("when the account holds a verified address an invitation was sent to", () => {
    /** @scenario A pending invitation is offered before asking to join */
    it("answers the invitation with the organisation's name and the seat it names", async () => {
      const { service, findOldestPendingInviteForAddress } = harness({
        "sam@acme.com": { inviteCode: "code_1", role: "DEVELOPER" },
      });

      await expect(
        service.findPendingForAddresses({ addresses: ["Sam@Acme.com"] }),
      ).resolves.toEqual([
        { inviteCode: "code_1", organizationName: "Acme", inviterName: "Dana", role: "DEVELOPER" },
      ]);
      expect(findOldestPendingInviteForAddress).toHaveBeenCalledWith({ address: "sam@acme.com" });
    });

    /** @scenario A signed-in invitation names who invited the person */
    it("carries the inviter's name for the offer to show", async () => {
      const { service } = harness({ "sam@acme.com": { inviteCode: "code_1", role: "MEMBER" } });

      const [pending] = await service.findPendingForAddresses({ addresses: ["sam@acme.com"] });

      expect(pending?.inviterName).toBe("Dana");
    });

    /** @scenario A pending invitation is offered before asking to join */
    it("asks once per distinct proven address and keeps only the addresses that hold one", async () => {
      const { service, findOldestPendingInviteForAddress } = harness({
        "sam@other.example": { inviteCode: "code_2", role: "MEMBER" },
      });

      const pending = await service.findPendingForAddresses({
        addresses: ["sam@acme.com", "SAM@acme.com", "sam@other.example"],
      });

      expect(findOldestPendingInviteForAddress).toHaveBeenCalledTimes(2);
      expect(pending).toEqual([
        { inviteCode: "code_2", organizationName: "Acme", inviterName: "Dana", role: "MEMBER" },
      ]);
    });
  });

  describe("when the account has proved no address", () => {
    /** @scenario An invitation is only offered to somebody who proved the address */
    it("asks nothing and answers nothing", async () => {
      const { service, findOldestPendingInviteForAddress } = harness({});

      await expect(service.findPendingForAddresses({ addresses: [] })).resolves.toEqual([]);
      expect(findOldestPendingInviteForAddress).not.toHaveBeenCalled();
    });
  });
});
