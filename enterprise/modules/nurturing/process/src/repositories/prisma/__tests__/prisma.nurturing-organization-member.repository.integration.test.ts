// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * @vitest-environment node
 * Nurturing's member copy and its organization creation copy through the tenancy guards: the
 * member reads and the hourly window sweep's read.
 * Spec: enterprise/modules/nurturing/specs/project-usage.feature
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

import { PrismaNurturingOrganizationCreatedRepository } from "../prisma.nurturing-organization-created.repository.ts";
import { PrismaNurturingOrganizationMemberRepository } from "../prisma.nurturing-organization-member.repository.ts";

const databaseUrl = process.env.LANGWATCH_TEST_DATABASE_URL;
const namespace = `test-nurturing-member-${randomUUID()}`;
const organizationId = `${namespace}-org`;
const otherOrganizationId = `${namespace}-other`;
const userId = `${namespace}-user`;

describe.skipIf(!databaseUrl)("given nurturing's member and organization creation copies", () => {
  let connection: PrismaConnection;
  let members: PrismaNurturingOrganizationMemberRepository;
  let organizationsCreated: PrismaNurturingOrganizationCreatedRepository;

  beforeAll(() => {
    if (!databaseUrl) throw new Error("LANGWATCH_TEST_DATABASE_URL is required here");
    connection = PrismaConnectionService.create({
      guard: PrismaTenancyGuardService.create(),
      logger: createLogger("langwatch:nurturing:test:members"),
    }).connect(PrismaConfigService.create().resolve({ databaseUrl, log: ["error"] }));
    members = PrismaNurturingOrganizationMemberRepository.create({ prisma: connection.client });
    organizationsCreated = PrismaNurturingOrganizationCreatedRepository.create({
      prisma: connection.client,
    });
  });

  afterAll(async () => {
    if (!connection) return;
    for (const id of [organizationId, otherOrganizationId]) {
      await connection.client.nurturingOrganizationMember.deleteMany({
        where: { organizationId: id },
      });
      await connection.client.nurturingOrganizationCreated.deleteMany({
        where: { organizationId: id },
      });
    }
    await connection.closeOnce();
  });

  /** @scenario "Nurturing keeps its own copy of an organization's members" */
  it("keeps each change's latest time and reads the members' other memberships", async () => {
    const record = (organization: string, change: "joined" | "left", at: number) =>
      members.recordMembershipChange({ organizationId: organization, userId, change, at });

    await record(organizationId, "left", 3_000);
    await record(organizationId, "joined", 1_000);
    await record(organizationId, "joined", 1_000);
    await record(otherOrganizationId, "joined", 2_000);

    const read = await members.findMembershipsOfMembers({ organizationId });
    expect(read.toSorted((a, b) => a.organizationId.localeCompare(b.organizationId))).toEqual([
      { organizationId, userId, joinedAt: 1_000, leftAt: 3_000, returnedAt: null },
      {
        organizationId: otherOrganizationId,
        userId,
        joinedAt: 2_000,
        leftAt: null,
        returnedAt: null,
      },
    ]);
  });

  /** @scenario "The trace traits are removed once when an organization's window ends" */
  it("answers the organizations created in the sweep's span", async () => {
    const at = Date.UTC(2001, 0, 1);
    await organizationsCreated.recordOrganizationCreated({ organizationId, createdAt: at });

    const found = await organizationsCreated.findOrganizationIdsCreatedBetween({
      after: at - 1,
      upTo: at,
    });

    expect(found).toContain(organizationId);
  });
});
