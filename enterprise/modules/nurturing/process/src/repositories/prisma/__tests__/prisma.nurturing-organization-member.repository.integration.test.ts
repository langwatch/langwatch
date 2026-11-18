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

import { erasedUserHashOf } from "../../../rules/nurturing-virtual-key.rules.ts";
import { PrismaNurturingErasedUserRepository } from "../prisma.nurturing-erased-user.repository.ts";
import { PrismaNurturingOrganizationCreatedRepository } from "../prisma.nurturing-organization-created.repository.ts";
import { PrismaNurturingOrganizationMemberRepository } from "../prisma.nurturing-organization-member.repository.ts";
import { stoppedBeforeRecheck } from "./nurturing-stopped-worker.test-helpers.ts";

const databaseUrl = process.env.LANGWATCH_TEST_DATABASE_URL;
const namespace = `test-nurturing-member-${randomUUID()}`;
const organizationId = `${namespace}-org`;
const otherOrganizationId = `${namespace}-other`;
const userId = `${namespace}-user`;
/** People a test erases; their erasure marks are removed with the test's rows. */
const erasedUserIds = [
  `${namespace}-erased`,
  `${namespace}-erased-mid-commit`,
  `${namespace}-erased-stopped`,
] as const;
const [erased, erasedMidCommit, erasedStopped] = erasedUserIds;

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
    await connection.client.nurturingErasedUser.deleteMany({
      where: { userIdHash: { in: erasedUserIds.map(erasedUserHashOf) } },
    });
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

  it("reads every membership of the named users, including one with no row in this organization", async () => {
    const elsewhere = `${namespace}-elsewhere`;
    await members.recordMembershipChange({
      organizationId: otherOrganizationId,
      userId: elsewhere,
      change: "joined",
      at: 4_000,
    });

    const read = await members.findMembershipsOfUsers({ userIds: [elsewhere] });

    expect(read).toEqual([
      {
        organizationId: otherOrganizationId,
        userId: elsewhere,
        joinedAt: 4_000,
        leftAt: null,
        returnedAt: null,
      },
    ]);
  });

  /** @scenario "A member fact landing after an erasure writes no member row in Postgres" */
  it("writes no row for an erased account's late join", async () => {
    await members.recordMembershipChange({
      organizationId,
      userId: erased,
      change: "joined",
      at: 1_000,
    });
    await members.forgetMember({ userId: erased });

    await members.recordMembershipChange({
      organizationId,
      userId: erased,
      change: "joined",
      at: 2_000,
    });

    await expect(members.findMembershipsOfUsers({ userIds: [erased] })).resolves.toEqual([]);
  });

  /** @scenario "A member fact landing while an erasure commits leaves no member row in Postgres" */
  it("deletes the row a join wrote once the erasure's mark is there", async () => {
    const joined = (at: number) =>
      members.recordMembershipChange({
        organizationId,
        userId: erasedMidCommit,
        change: "joined",
        at,
      });
    await joined(1_000);
    // The erasure's mark has committed but its DELETE has not run, as when a join read no mark
    // and wrote its row after that DELETE had passed.
    await connection.client.nurturingErasedUser.create({
      data: { userIdHash: erasedUserHashOf(erasedMidCommit) },
    });

    await joined(2_000);

    await expect(members.findMembershipsOfUsers({ userIds: [erasedMidCommit] })).resolves.toEqual(
      [],
    );
  });

  /** @scenario "A member fact for a marked account writes no row even if its re-check never runs" */
  it("rejects and leaves no row, the write itself having read the mark", async () => {
    await PrismaNurturingErasedUserRepository.create({ prisma: connection.client }).markErased({
      userId: erasedStopped,
    });
    const stopping = PrismaNurturingOrganizationMemberRepository.create({
      prisma: stoppedBeforeRecheck(connection.client),
    });

    await expect(
      stopping.recordMembershipChange({
        organizationId,
        userId: erasedStopped,
        change: "joined",
        at: 1_000,
      }),
    ).rejects.toThrow("re-check");

    await expect(members.findMembershipsOfUsers({ userIds: [erasedStopped] })).resolves.toEqual([]);
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
