import { createLogger } from "@langwatch/observability";
import {
  PrismaConfigService,
  PrismaConnectionService,
  PrismaTenancyGuardService,
} from "@langwatch/prisma-client";
/**
 * @vitest-environment node
 * @see specs/identity/join-before-create.feature
 * The pending-invitation read against the REAL guarded client: the guard
 * admits one address per read.
 */
import { describe, expect, it } from "vitest";

import { PrismaOrganizationInviteRepository } from "../../../../repositories/prisma/prisma.organization-invite.repository.ts";

const DB_URL = process.env.LANGWATCH_TEST_DATABASE_URL;

describe.skipIf(!DB_URL)("the pending-invitation read on the guarded client", () => {
  const prisma = PrismaConnectionService.create({
    guard: PrismaTenancyGuardService.create(),
    logger: createLogger("langwatch:organization:test:pending-for-addresses"),
  }).connect(
    PrismaConfigService.create().resolve({ databaseUrl: DB_URL ?? "", log: ["error"] }),
  ).client;
  const invites = PrismaOrganizationInviteRepository.create({ database: prisma });

  describe("when the account has proven several addresses", () => {
    /** @scenario A pending invitation is offered before asking to join */
    it("is admitted by the tenancy guard, one address per read", async () => {
      await expect(
        Promise.all(
          ["sam@acme.example", "sam@other.example"].map((address) =>
            invites.findOldestPendingInviteForAddress({ address }),
          ),
        ),
      ).resolves.toEqual([null, null]);
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

  describe("when an operator looks one address up across every organization", () => {
    /** @scenario "Outstanding invitations are listed with what is left of them" */
    it("is admitted by the tenancy guard as a declared operator read", async () => {
      await expect(
        invites.findPendingInvitesForAddress({ address: "nobody-invited@acme.example" }),
      ).resolves.toEqual([]);
    });
  });
});
