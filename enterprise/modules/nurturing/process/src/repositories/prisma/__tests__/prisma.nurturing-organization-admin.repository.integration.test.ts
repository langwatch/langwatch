// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * @vitest-environment node
 * Nurturing's organization admin through the tenancy guards: the upsert is the order-free fold in
 * SQL, the memory twin folding the same facts holds the same admin, and the erasure marks keep an
 * erased admin off the row.
 * Spec: enterprise/modules/nurturing/specs/nurturing.feature,
 * enterprise/modules/nurturing/specs/project-facts-copies.feature
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
import { MemoryNurturingMilestonesRepository } from "../../memory/memory.nurturing-milestones.repository.ts";
import type { NurturingOrganizationAdminRepository } from "../../nurturing-milestones.repository.ts";
import { PrismaNurturingErasedUserRepository } from "../prisma.nurturing-erased-user.repository.ts";
import { PrismaNurturingMilestonesRepository } from "../prisma.nurturing-milestones.repository.ts";
import { stoppedBeforeRecheck } from "./nurturing-stopped-worker.test-helpers.ts";

type AdminFact = Parameters<NurturingOrganizationAdminRepository["recordAdminFact"]>[0];

const databaseUrl = process.env.LANGWATCH_TEST_DATABASE_URL;
const run = randomUUID();
const organizationIds = new Set<string>();
/** An organization a test writes; its row is removed with the test's rows. */
const organization = (name: string) => {
  const organizationId = `test-nurturing-admin-${name}-${run}`;
  organizationIds.add(organizationId);
  return organizationId;
};
const erasedUserIds = new Set<string>();
/** A person a test erases; their erasure mark is removed with the test's rows. */
const erasedPerson = (name: string) => {
  const userId = `test-nurturing-admin-${name}-${run}`;
  erasedUserIds.add(userId);
  return userId;
};

const fact = (organizationId: string, overrides: Partial<AdminFact>): AdminFact => ({
  organizationId,
  adminUserId: "admin-a",
  at: 1_000,
  seeded: false,
  ...overrides,
});

describe.skipIf(!databaseUrl)("given nurturing's organization admin in Postgres", () => {
  let connection: PrismaConnection;
  let organizations: PrismaNurturingMilestonesRepository;

  /** The admin, its stamp and `seeded` as the table holds them, a marked admin included. */
  const stored = (organizationId: string) =>
    connection.client.nurturingOrganization.findUnique({
      where: { organizationId },
      select: { adminUserId: true, adminAt: true, seeded: true, updatedAt: true },
    });

  beforeAll(() => {
    if (!databaseUrl) throw new Error("LANGWATCH_TEST_DATABASE_URL is required here");
    connection = PrismaConnectionService.create({
      guard: PrismaTenancyGuardService.create(),
      logger: createLogger("langwatch:nurturing:test:organization-admin"),
    }).connect(PrismaConfigService.create().resolve({ databaseUrl, log: ["error"] }));
    organizations = PrismaNurturingMilestonesRepository.create({ prisma: connection.client });
  });

  afterAll(async () => {
    if (!connection) return;
    for (const organizationId of organizationIds) {
      await connection.client.nurturingOrganization.deleteMany({ where: { organizationId } });
    }
    const userIdHash = { in: [...erasedUserIds].map(erasedUserHashOf) };
    await connection.client.nurturingErasedUser.deleteMany({ where: { userIdHash } });
    await connection.closeOnce();
  });

  describe("when an organization's project-created facts land in one order and in its reverse", () => {
    /** @scenario "The organization's admin is the latest-stamped one whatever order the facts land in" */
    it("holds the same admin, stamp and seeded flag both ways, as the memory twin does", async () => {
      const facts = (organizationId: string) => [
        fact(organizationId, { adminUserId: "admin-a", at: 1_000 }),
        fact(organizationId, { adminUserId: "admin-c", at: 3_000 }),
        fact(organizationId, { adminUserId: null, at: 4_000, seeded: true }),
        fact(organizationId, { adminUserId: "admin-b", at: 2_000 }),
      ];
      const forward = organization("forward");
      const reverse = organization("reverse");
      const twin = MemoryNurturingMilestonesRepository.create();
      for (const next of facts(forward)) await organizations.recordAdminFact(next);
      for (const next of facts(reverse).toReversed()) await organizations.recordAdminFact(next);
      for (const next of facts(forward)) await twin.recordAdminFact(next);

      const expected = { adminUserId: "admin-c", adminAt: new Date(3_000), seeded: true };
      await expect(stored(forward)).resolves.toMatchObject(expected);
      await expect(stored(reverse)).resolves.toMatchObject(expected);
      const [held] = await twin.findOrganization({ organizationId: forward });
      expect(held).toMatchObject({ adminUserId: "admin-c", seeded: true });
    });

    it("keeps the greater id for two admins at one stamp, in either order", async () => {
      const forward = organization("tie-forward");
      const reverse = organization("tie-reverse");
      const tied = (organizationId: string) => [
        fact(organizationId, { adminUserId: "admin-a", at: 1_000 }),
        fact(organizationId, { adminUserId: "admin-b", at: 1_000 }),
      ];
      for (const next of tied(forward)) await organizations.recordAdminFact(next);
      for (const next of tied(reverse).toReversed()) await organizations.recordAdminFact(next);

      await expect(stored(forward)).resolves.toMatchObject({ adminUserId: "admin-b" });
      await expect(stored(reverse)).resolves.toMatchObject({ adminUserId: "admin-b" });
    });
  });

  describe("when a project-created fact is delivered again", () => {
    /** @scenario "A redelivered project-created fact leaves the organization's row as it was" */
    it("writes nothing, so the row's update time stays", async () => {
      const organizationId = organization("redelivered");
      const created = fact(organizationId, { seeded: true });
      await organizations.recordAdminFact(created);
      const before = await stored(organizationId);

      await organizations.recordAdminFact(created);

      await expect(stored(organizationId)).resolves.toEqual(before);
    });
  });

  describe("when a late fact names an erased person admin", () => {
    /** @scenario "A late project-created fact naming an erased admin writes no admin" */
    it("writes no admin at the fact's stamp, clearing the admin an earlier fact named", async () => {
      const organizationId = organization("late-erased");
      const person = erasedPerson("late-erased");
      await organizations.recordAdminFact(fact(organizationId, { adminUserId: "admin-a" }));
      await organizations.forgetAdmin({ adminUserId: person });

      await organizations.recordAdminFact(fact(organizationId, { adminUserId: person, at: 2_000 }));
      await organizations.recordAdminFact(fact(organizationId, { adminUserId: "admin-b" }));

      await expect(stored(organizationId)).resolves.toMatchObject({
        adminUserId: null,
        adminAt: new Date(2_000),
      });
    });

    it("creates the row naming no admin when it is the organization's first fact", async () => {
      const organizationId = organization("first-erased");
      const person = erasedPerson("first-erased");
      await organizations.forgetAdmin({ adminUserId: person });

      await organizations.recordAdminFact(fact(organizationId, { adminUserId: person }));

      await expect(stored(organizationId)).resolves.toMatchObject({
        adminUserId: null,
        adminAt: new Date(1_000),
      });
    });
  });

  describe("when an admin's fact is redelivered after their erasure's mark but before its clearing", () => {
    /** @scenario "A project-created fact landing while its admin's erasure commits leaves no admin" */
    it("clears the admin the first delivery wrote", async () => {
      const organizationId = organization("mid-commit");
      const person = erasedPerson("mid-commit");
      const created = fact(organizationId, { adminUserId: person });
      await organizations.recordAdminFact(created);
      // The erasure's mark has committed but its clearing UPDATE has not run, as when a fact read
      // no mark and wrote its admin after that UPDATE had passed.
      await connection.client.nurturingErasedUser.create({
        data: { userIdHash: erasedUserHashOf(person) },
      });

      await organizations.recordAdminFact(created);

      await expect(stored(organizationId)).resolves.toMatchObject({
        adminUserId: null,
        adminAt: new Date(1_000),
      });
    });
  });

  describe("when a worker stops between a marked admin's write and its re-check", () => {
    /** @scenario "A project-created fact for a marked admin writes no admin even if its re-check never runs" */
    it("rejects and leaves no admin, the write itself having read the mark", async () => {
      const organizationId = organization("stopped");
      const person = erasedPerson("stopped");
      await PrismaNurturingErasedUserRepository.create({ prisma: connection.client }).markErased({
        userId: person,
      });
      const stopping = PrismaNurturingMilestonesRepository.create({
        prisma: stoppedBeforeRecheck(connection.client),
      });

      await expect(
        stopping.recordAdminFact(fact(organizationId, { adminUserId: person })),
      ).rejects.toThrow("re-check");

      await expect(stored(organizationId)).resolves.toMatchObject({ adminUserId: null });
    });
  });
});
