/**
 * @vitest-environment node
 *
 * specs/identity/join-before-create.feature — the welcome screen's
 * pending-invitation read against the REAL guarded client.
 *
 * The unit tests mock Prisma, so they cannot say whether the tenancy guard
 * admits the read's shape; it once did not, and the refusal stayed invisible
 * for as long as the address list arrived empty. This drives the service
 * through the exported client, which carries the guard chain, so the shape
 * the guard admits and the shape it refuses are both pinned here.
 */

import { describe, expect, it } from "vitest";
import { prisma } from "~/server/db";
import { InviteService } from "../invite.service";

describe("InviteService.findPendingForAddresses() on the guarded client", () => {
  describe("when the account has proven several addresses", () => {
    /** @scenario A pending invitation is offered before asking to join */
    it("is admitted by the tenancy guard, one address per read", async () => {
      const service = InviteService.create(prisma);

      await expect(
        service.findPendingForAddresses({
          addresses: ["sam@acme.example", "sam@other.example"],
        }),
      ).resolves.toEqual([]);
    });

    /** @scenario A pending invitation is offered before asking to join */
    it("would be refused as one read over every address, which is why it is not written that way", async () => {
      await expect(
        prisma.organizationInvite.findMany({
          where: {
            status: "PENDING",
            OR: [
              { email: { equals: "sam@acme.example", mode: "insensitive" } },
              { email: { equals: "sam@other.example", mode: "insensitive" } },
            ],
          },
          select: { inviteCode: true },
        }),
      ).rejects.toThrow(/OrganizationInvite/);
    });
  });
});
