// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * @vitest-environment node
 * A directory create's membership row and its member-created fact commit together in Postgres.
 * @see modules/organization/specs/seat-peak.feature
 */
import { createLogger } from "@langwatch/observability";
import {
  PrismaConfigService,
  PrismaConnectionService,
  PrismaTenancyGuardService,
} from "@langwatch/prisma-client";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import { nanoid } from "nanoid";
import { afterAll, describe, expect, it } from "vitest";

import { PrismaScimRepository } from "../prisma.scim.repository.ts";

const DB_URL = process.env.LANGWATCH_TEST_DATABASE_URL;

describe.skipIf(!DB_URL)("SCIM's member-created fact (Postgres)", () => {
  const ns = nanoid(6).toLowerCase();
  const connection = PrismaConnectionService.create({
    guard: PrismaTenancyGuardService.create(),
    logger: createLogger("langwatch:scim:test:member-created"),
  }).connect(PrismaConfigService.create().resolve({ databaseUrl: DB_URL ?? "", log: ["error"] }));
  const prisma = connection.client as PrismaClient;
  const repository = PrismaScimRepository.create(prisma);
  const organizationIds: string[] = [];
  const userIds: string[] = [];

  async function directoryPerson(): Promise<{ organizationId: string; userId: string }> {
    const organization = await prisma.organization.create({
      data: { name: "directory", slug: `--${ns}-${nanoid(4).toLowerCase()}` },
    });
    organizationIds.push(organization.id);
    const user = await prisma.user.create({
      data: { email: `pushed-${nanoid(6)}-${ns}@acme.test`, name: "Pushed" },
    });
    userIds.push(user.id);
    return { organizationId: organization.id, userId: user.id };
  }

  async function facts(organizationId: string) {
    const rows = await prisma.processManagerOutbox.findMany({
      where: { processName: "scimMembership", projectId: organizationId },
    });
    return rows.map((row) => ({ intentType: row.intentType, ...(row.payload as object) }));
  }

  afterAll(async () => {
    const inOrganizations = { in: organizationIds };
    await prisma.processManagerOutbox.deleteMany({ where: { projectId: inOrganizations } });
    await prisma.organizationUser.deleteMany({ where: { organizationId: inOrganizations } });
    await prisma.organization.deleteMany({ where: { id: inOrganizations } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.$disconnect();
  });

  describe("when the directory creates a member on a full seat", () => {
    /** @scenario "A seat taken on any path is counted" */
    it("commits one member-created fact with the membership row", async () => {
      const { organizationId, userId } = await directoryPerson();

      await repository.addMembership({ organizationId, userId, role: "MEMBER" });

      expect(await facts(organizationId)).toEqual([
        expect.objectContaining({
          intentType: "recordMemberCreated",
          organizationId,
          userId,
          createId: expect.any(String),
        }),
      ]);
    });
  });

  describe("when a retried create loses to the membership already written", () => {
    it("rolls its fact back with the refused row", async () => {
      const { organizationId, userId } = await directoryPerson();
      await repository.addMembership({ organizationId, userId, role: "MEMBER" });

      await expect(
        repository.addMembership({ organizationId, userId, role: "MEMBER" }),
      ).rejects.toMatchObject({ code: "P2002" });

      expect(await facts(organizationId)).toHaveLength(1);
    });
  });

  describe("when the directory create is held for a seat", () => {
    it("still commits the fact, leaving the seat to organization's own rule", async () => {
      const { organizationId, userId } = await directoryPerson();

      await repository.addMembership({
        organizationId,
        userId,
        role: "EXTERNAL",
        pending: true,
      });

      expect(await facts(organizationId)).toEqual([
        expect.objectContaining({ organizationId, userId }),
      ]);
    });
  });
});
