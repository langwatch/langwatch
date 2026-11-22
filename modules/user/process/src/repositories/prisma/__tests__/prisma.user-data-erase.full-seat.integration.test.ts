/**
 * @vitest-environment node
 * Postgres erasure: the erased fact names the organisations whose seat it took, and which of them
 * were full seats, read before the memberships go.
 * @see modules/ops/specs/seat-sharing-check.feature
 */
import { randomUUID } from "node:crypto";

import { createLogger } from "@langwatch/observability";
import {
  PrismaConfigService,
  PrismaConnectionService,
  PrismaQueryGuard,
  type PrismaConnection,
  type PrismaQueryContext,
  type PrismaQueryExecutor,
} from "@langwatch/prisma-client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { PrismaGdprUserDataEraseRepository } from "../prisma.user-data-erase.repository.ts";

const databaseUrl = process.env.LANGWATCH_TEST_DATABASE_URL ?? process.env.DATABASE_URL;
const RUN = `erase-seat-${randomUUID()}`;

/** The erase is cross-tenant by design, so it runs unscoped. */
class AllowEraseQueries extends PrismaQueryGuard {
  execute(context: PrismaQueryContext, next: PrismaQueryExecutor): Promise<unknown> {
    return next(context.args);
  }
}

describe.skipIf(!databaseUrl)(
  "given a person who is a member of one organisation and an external of another",
  () => {
    let connection: PrismaConnection;
    let userId: string;
    let memberOrgId: string;
    let externalOrgId: string;

    beforeAll(async () => {
      if (!databaseUrl) throw new Error("Test database URL is required");
      connection = PrismaConnectionService.create({
        guard: new AllowEraseQueries(),
        logger: createLogger("langwatch:user-data-erase:test"),
      }).connect(PrismaConfigService.create().resolve({ databaseUrl, log: ["error"] }));
      const prisma = connection.client;
      userId = (await prisma.user.create({ data: { name: "Ada", email: `ada@${RUN}.test` } })).id;
      memberOrgId = (
        await prisma.organization.create({ data: { name: "ACME", slug: `${RUN}-member` } })
      ).id;
      externalOrgId = (
        await prisma.organization.create({
          data: { name: "ACME Partner", slug: `${RUN}-external` },
        })
      ).id;
      const team = await prisma.team.create({
        data: { name: RUN, slug: RUN, organizationId: externalOrgId },
      });
      const viewOnly = await prisma.customRole.create({
        data: { organizationId: externalOrgId, name: RUN, permissions: ["traces:view"] },
      });
      await prisma.organizationUser.createMany({
        data: [
          { userId, organizationId: memberOrgId, role: "MEMBER", membershipStamp: `${RUN}-a` },
          { userId, organizationId: externalOrgId, role: "EXTERNAL", membershipStamp: `${RUN}-b` },
        ],
      });
      await prisma.roleBinding.create({
        data: {
          organizationId: externalOrgId,
          userId,
          role: "CUSTOM",
          customRoleId: viewOnly.id,
          scopeType: "TEAM",
          scopeId: team.id,
        },
      });

      await PrismaGdprUserDataEraseRepository.create({
        database: prisma,
      }).eraseUserAndOwnedResources({
        userId,
        projectIds: [],
        soleOwnedTeamIds: [],
        soleOwnedOrgIds: [],
      });
    });

    afterAll(async () => {
      const prisma = connection.client;
      const organizationId = { in: [memberOrgId, externalOrgId] };
      await prisma.processManagerOutbox.deleteMany({ where: { tenantId: userId } });
      await prisma.roleBinding.deleteMany({ where: { organizationId } });
      await prisma.customRole.deleteMany({ where: { organizationId } });
      await prisma.organizationUser.deleteMany({ where: { organizationId } });
      await prisma.team.deleteMany({ where: { slug: RUN } });
      await prisma.organization.deleteMany({ where: { id: organizationId } });
      await prisma.user.deleteMany({ where: { id: userId } });
      await prisma.$disconnect();
    });

    describe("when their account is erased", () => {
      /** @scenario "Erasure records the organizations where the person held a full seat" */
      it("names both organisations and only the member one as a full seat", async () => {
        const rows = await connection.client.processManagerOutbox.findMany({
          where: { tenantId: userId },
          select: { payload: true },
        });
        const payload = JSON.stringify(rows.map((row) => row.payload));

        expect(rows.length).toBeGreaterThan(0);
        expect(payload).toContain(`"fullSeatOrganizationIds":["${memberOrgId}"]`);
        expect(payload).toContain(memberOrgId);
        expect(payload).toContain(externalOrgId);
      });
    });
  },
);
