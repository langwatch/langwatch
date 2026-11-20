// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * @vitest-environment node
 * An erased account leaves nurturing's own rows, across organizations, through the tenancy guard.
 * Spec: enterprise/modules/nurturing/specs/project-facts-copies.feature
 */
import { randomUUID } from "node:crypto";

import { createLogger } from "@langwatch/observability";
import {
  PrismaConfigService,
  PrismaConnectionService,
  PrismaTenancyGuardService,
  type PrismaConnection,
} from "@langwatch/prisma-client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { PrismaNurturingMilestonesRepository } from "../prisma.nurturing-milestones.repository.ts";
import { PrismaNurturingPersonalProjectRepository } from "../prisma.nurturing-personal-project.repository.ts";

const databaseUrl = process.env.LANGWATCH_TEST_DATABASE_URL;
const run = randomUUID();
const organizationIds = [`test-nurturing-erasure-a-${run}`, `test-nurturing-erasure-b-${run}`];
const [firstOrganization, secondOrganization] = organizationIds as [string, string];
const erased = `test-nurturing-erasure-erased-${run}`;
const kept = `test-nurturing-erasure-kept-${run}`;
const projectId = (name: string) => `test-nurturing-erasure-${name}-${run}`;

describe.skipIf(!databaseUrl)("given nurturing's rows naming two accounts", () => {
  let connection: PrismaConnection;
  let personalProjects: PrismaNurturingPersonalProjectRepository;
  let organizations: PrismaNurturingMilestonesRepository;

  beforeAll(async () => {
    if (!databaseUrl) throw new Error("LANGWATCH_TEST_DATABASE_URL is required here");
    connection = PrismaConnectionService.create({
      guard: PrismaTenancyGuardService.create(),
      logger: createLogger("langwatch:nurturing:test:user-erasure"),
    }).connect(PrismaConfigService.create().resolve({ databaseUrl, log: ["error"] }));
    personalProjects = PrismaNurturingPersonalProjectRepository.create({
      prisma: connection.client,
    });
    organizations = PrismaNurturingMilestonesRepository.create({ prisma: connection.client });

    await personalProjects.recordOwner({
      projectId: projectId("erased-a"),
      organizationId: firstOrganization,
      ownerUserId: erased,
    });
    await personalProjects.recordOwner({
      projectId: projectId("erased-b"),
      organizationId: secondOrganization,
      ownerUserId: erased,
    });
    await personalProjects.recordOwner({
      projectId: projectId("kept"),
      organizationId: firstOrganization,
      ownerUserId: kept,
    });
    await organizations.recordOrganization({
      organizationId: firstOrganization,
      adminUserId: erased,
      seeded: false,
    });
    await organizations.recordOrganization({
      organizationId: secondOrganization,
      adminUserId: kept,
      seeded: false,
    });
  });

  afterAll(async () => {
    if (!connection) return;
    for (const organizationId of organizationIds) {
      await connection.client.nurturingPersonalProject.deleteMany({ where: { organizationId } });
      await connection.client.nurturingOrganization.deleteMany({ where: { organizationId } });
    }
    await connection.closeOnce();
  });

  const ownersIn = async (organizationId: string) =>
    (
      await connection.client.nurturingPersonalProject.findMany({
        where: { organizationId },
        select: { ownerUserId: true },
      })
    ).map(({ ownerUserId }) => ownerUserId);
  const adminOf = async (organizationId: string) =>
    (await organizations.findOrganization({ organizationId })).map((row) => row.adminUserId);

  describe("when one account is erased, twice", () => {
    /** @scenario "An erased account's owner and admin rows are cleared, and nothing is sent" */
    it("deletes its owner rows in both organizations, clears it as admin and keeps the other account", async () => {
      for (let delivery = 0; delivery < 2; delivery++) {
        await personalProjects.forgetOwner({ ownerUserId: erased });
        await organizations.forgetAdmin({ adminUserId: erased });
      }

      await expect(ownersIn(firstOrganization)).resolves.toEqual([kept]);
      await expect(ownersIn(secondOrganization)).resolves.toEqual([]);
      await expect(adminOf(firstOrganization)).resolves.toEqual([null]);
      await expect(adminOf(secondOrganization)).resolves.toEqual([kept]);
    });
  });

  describe("when an account no row names is erased", () => {
    /** @scenario "An erasure of an account nurturing holds no row for changes nothing" */
    it("leaves the other account's rows as they were", async () => {
      const nobody = `test-nurturing-erasure-nobody-${run}`;

      await personalProjects.forgetOwner({ ownerUserId: nobody });
      await organizations.forgetAdmin({ adminUserId: nobody });

      await expect(ownersIn(firstOrganization)).resolves.toContain(kept);
      await expect(adminOf(secondOrganization)).resolves.toEqual([kept]);
    });
  });
});
