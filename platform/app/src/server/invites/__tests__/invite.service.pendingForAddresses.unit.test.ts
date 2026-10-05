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
 * Spec: specs/identity/join-before-create.feature
 */
describe("InviteService.findPendingForAddresses()", () => {
  const findMany = vi.fn();
  const prisma = {
    organizationInvite: { findMany },
  } as unknown as PrismaClient;
  const service = new InviteService(prisma, {} as never, {} as never);

  describe("when the account holds a verified address an invitation was sent to", () => {
    /** @scenario A pending invitation is offered before asking to join */
    it("answers the invitation with the organisation's name and the seat it names", async () => {
      findMany.mockResolvedValueOnce([
        {
          inviteCode: "code_1",
          role: "DEVELOPER",
          organization: { name: "Acme" },
        },
      ]);

      const pending = await service.findPendingForAddresses({
        addresses: ["Sam@Acme.com"],
      });

      expect(pending).toEqual([
        { inviteCode: "code_1", organizationName: "Acme", role: "DEVELOPER" },
      ]);
      // PENDING, unexpired, on one of the proven addresses, matched however
      // the administrator capitalised it when inviting.
      expect(findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            status: "PENDING",
            AND: expect.arrayContaining([
              {
                OR: [
                  { email: { equals: "sam@acme.com", mode: "insensitive" } },
                ],
              },
            ]),
          }),
        }),
      );
    });
  });

  describe("when the account has proved no address", () => {
    /** @scenario An invitation is only offered to somebody who proved the address */
    it("asks nothing and answers nothing", async () => {
      findMany.mockClear();

      const pending = await service.findPendingForAddresses({ addresses: [] });

      expect(pending).toEqual([]);
      expect(findMany).not.toHaveBeenCalled();
    });
  });
});
