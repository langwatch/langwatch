/** @vitest-environment node */

import { describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "~/generated/prisma/client";
import { InviteService } from "../invite.service";

/**
 * The invitations waiting for an account, read by the addresses it has
 * PROVED and nothing else.
 *
 * The welcome screen leads with one of these before offering to ask to join,
 * and what it hands back is the invitation code, which is the secret from
 * the mail. So the read takes a list of addresses the caller has already
 * verified, lowercases them the way the invite was stored, and never falls
 * back to anything softer.
 *
 * The read is one `findFirst` per address, never one `findMany` over them
 * all: that is the only subject-bounded shape the tenancy guard admits on
 * invitations, and a `findMany` naming several addresses is refused at
 * runtime (which no mock would have shown).
 *
 * Spec: specs/identity/join-before-create.feature
 */
describe("InviteService.findPendingForAddresses()", () => {
  const findFirst = vi.fn();
  const findMany = vi.fn();
  const prisma = {
    organizationInvite: { findFirst, findMany },
  } as unknown as PrismaClient;
  const service = new InviteService(prisma, {} as never, {} as never);

  describe("when the account holds a verified address an invitation was sent to", () => {
    /** @scenario A pending invitation is offered before asking to join */
    it("answers the invitation with the organisation's name and the seat it names", async () => {
      findFirst.mockResolvedValueOnce({
        inviteCode: "code_1",
        role: "DEVELOPER",
        organization: { name: "Acme" },
      });

      const pending = await service.findPendingForAddresses({
        addresses: ["Sam@Acme.com"],
      });

      expect(pending).toEqual([
        { inviteCode: "code_1", organizationName: "Acme", role: "DEVELOPER" },
      ]);
      // PENDING, unexpired, on ONE proven address per read, matched however
      // the administrator capitalised it when inviting.
      expect(findFirst).toHaveBeenCalledTimes(1);
      expect(findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            email: { equals: "sam@acme.com", mode: "insensitive" },
            status: "PENDING",
          }),
        }),
      );
      expect(findMany).not.toHaveBeenCalled();
    });

    /** @scenario A pending invitation is offered before asking to join */
    it("asks once per distinct proven address and keeps only the addresses that hold one", async () => {
      findFirst.mockClear();
      findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce({
        inviteCode: "code_2",
        role: "MEMBER",
        organization: { name: "Acme" },
      });

      const pending = await service.findPendingForAddresses({
        addresses: ["sam@acme.com", "SAM@acme.com", "sam@other.example"],
      });

      expect(findFirst).toHaveBeenCalledTimes(2);
      expect(pending).toEqual([
        { inviteCode: "code_2", organizationName: "Acme", role: "MEMBER" },
      ]);
    });
  });

  describe("when the account has proved no address", () => {
    /** @scenario An invitation is only offered to somebody who proved the address */
    it("asks nothing and answers nothing", async () => {
      findFirst.mockClear();

      const pending = await service.findPendingForAddresses({ addresses: [] });

      expect(pending).toEqual([]);
      expect(findFirst).not.toHaveBeenCalled();
    });
  });
});
