/**
 * @vitest-environment node
 * @see specs/organizations/organization-members-rest-api.feature
 * An acceptance parked on a revoke's row lock re-reads the revoked row: no membership lands.
 */
import { createApiFixture } from "@langwatch/api-fixture";
import { createLogger } from "@langwatch/observability";
import type { OrganizationInvite } from "@langwatch/organization-contract";
import {
  PrismaConfigService,
  PrismaConnectionService,
  PrismaTenancyGuardService,
} from "@langwatch/prisma-client";
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { raceOnOneRow } from "../../repositories/prisma/__tests__/support/row-lock-race.ts";
import { PrismaOrganizationInviteRepository } from "../../repositories/prisma/prisma.organization-invite.repository.ts";
import type { InviteServiceDependencies } from "../../rules/invite-contracts.rules.ts";
import { InviteAcceptanceService } from "../invite-acceptance.service.ts";

const DB_URL = process.env.LANGWATCH_TEST_DATABASE_URL;

describe.skipIf(!DB_URL)("accepting an invitation on Postgres", () => {
  const ns = `inv-accept-${nanoid(8)}`;
  const connection = PrismaConnectionService.create({
    guard: PrismaTenancyGuardService.create(),
    logger: createLogger("langwatch:organization:test:invite-revoke-race"),
  }).connect(PrismaConfigService.create().resolve({ databaseUrl: DB_URL ?? "", log: ["error"] }));
  const prisma = connection.client;
  const acceptance = InviteAcceptanceService.create(
    createApiFixture<InviteServiceDependencies>({
      invites: PrismaOrganizationInviteRepository.create({ database: prisma }),
    }),
  );
  let organizationId: string;
  let inviteeUserId: string;

  beforeAll(async () => {
    const organization = await prisma.organization.create({
      data: { name: "ACME", slug: `--${ns}` },
    });
    organizationId = organization.id;
    const invitee = await prisma.user.create({
      data: { email: `invitee-${ns}@acme.test`, name: "Invitee" },
    });
    inviteeUserId = invitee.id;
  });

  afterAll(async () => {
    await prisma.organizationInvite.deleteMany({ where: { organizationId } });
    await prisma.organizationUser.deleteMany({ where: { organizationId } });
    await prisma.organization.delete({ where: { id: organizationId } });
    await prisma.user.delete({ where: { id: inviteeUserId } });
    await prisma.$disconnect();
  });

  describe("given a pending invitation an admin revokes as the invitee accepts it", () => {
    /** @scenario "A revocation landing during an acceptance stands" */
    it("refuses the acceptance and writes no membership, because the claim re-reads the row it waited for", async () => {
      const invite: OrganizationInvite = await prisma.organizationInvite.create({
        data: {
          email: `invitee-${ns}@acme.test`,
          inviteCode: `code-${ns}`,
          organizationId,
          teamIds: "",
          role: "MEMBER",
          expiration: new Date(Date.now() + 24 * 60 * 60 * 1000),
        },
      });

      const answers = await raceOnOneRow<string>({
        prisma,
        table: "OrganizationInvite",
        first: async (tx) => {
          await tx.$executeRaw`
            UPDATE "OrganizationInvite"
               SET "status" = 'REVOKED', "updatedAt" = now()
             WHERE "id" = ${invite.id}
               AND "organizationId" = ${organizationId}
               AND "status" IN ('PENDING', 'PAYMENT_PENDING')
          `;
          return "revoked";
        },
        second: () =>
          acceptance.applyInvite({ userId: inviteeUserId, invite }).then(
            () => "accepted",
            (error: { code?: string }) => `refused: ${error.code}`,
          ),
      });

      expect(answers.second).toBe("refused: invite_not_found");
      const row = await prisma.organizationInvite.findFirstOrThrow({
        where: { id: invite.id, organizationId },
      });
      expect(row.status).toBe("REVOKED");
      expect(row.acceptedByUserId).toBeNull();
      expect(
        await prisma.organizationUser.findFirst({
          where: { organizationId, userId: inviteeUserId },
        }),
      ).toBeNull();
    });
  });
});
