// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * @vitest-environment node
 * Nurturing's own copies of personal owners and traced projects, written from owners' facts; the
 * erasure marks keep an erased owner off the owner copy.
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

import { erasedUserHashOf } from "../../../rules/nurturing-virtual-key.rules.ts";
import { PrismaNurturingErasedUserRepository } from "../prisma.nurturing-erased-user.repository.ts";
import { PrismaNurturingPersonalProjectRepository } from "../prisma.nurturing-personal-project.repository.ts";
import { PrismaNurturingTracedProjectRepository } from "../prisma.nurturing-traced-project.repository.ts";
import { stoppedBeforeRecheck } from "./nurturing-stopped-worker.test-helpers.ts";

const databaseUrl = process.env.LANGWATCH_TEST_DATABASE_URL;
const run = randomUUID();
const organizationId = `test-nurturing-copies-${run}`;
const projectId = (name: string) => `test-nurturing-copies-${name}-${run}`;
/** People a test erases; their erasure marks are removed with the test's rows. */
const erasedUserIds = [
  `test-nurturing-copies-erased-${run}`,
  `test-nurturing-copies-erased-mid-commit-${run}`,
  `test-nurturing-copies-erased-stopped-${run}`,
] as const;
const [erased, erasedMidCommit, erasedStopped] = erasedUserIds;

describe.skipIf(!databaseUrl)("given nurturing's copies of project facts", () => {
  let connection: PrismaConnection;
  let personalProjects: PrismaNurturingPersonalProjectRepository;
  let tracedProjects: PrismaNurturingTracedProjectRepository;

  beforeAll(() => {
    if (!databaseUrl) throw new Error("LANGWATCH_TEST_DATABASE_URL is required here");
    connection = PrismaConnectionService.create({
      guard: PrismaTenancyGuardService.create(),
      logger: createLogger("langwatch:nurturing:test:project-copies"),
    }).connect(PrismaConfigService.create().resolve({ databaseUrl, log: ["error"] }));
    personalProjects = PrismaNurturingPersonalProjectRepository.create({
      prisma: connection.client,
    });
    tracedProjects = PrismaNurturingTracedProjectRepository.create({ prisma: connection.client });
  });

  afterAll(async () => {
    if (!connection) return;
    await connection.client.nurturingPersonalProject.deleteMany({ where: { organizationId } });
    await connection.client.nurturingTracedProject.deleteMany({ where: { organizationId } });
    await connection.client.nurturingErasedUser.deleteMany({
      where: { userIdHash: { in: erasedUserIds.map(erasedUserHashOf) } },
    });
    await connection.closeOnce();
  });

  describe("when one personal project's owner is recorded five times at once, the last differing", () => {
    /** @scenario "A new personal workspace leaves one owner row naming its member" */
    it("keeps one row with the first owner and raises no error", async () => {
      const raced = projectId("raced");
      const record = (ownerUserId: string) =>
        personalProjects.recordOwner({ projectId: raced, organizationId, ownerUserId });

      await Promise.all([1, 2, 3, 4].map(() => record("owner-1")));
      await record("owner-2");

      await expect(personalProjects.findOwnerUserIds({ projectId: raced })).resolves.toEqual([
        "owner-1",
      ]);
      await expect(
        connection.client.nurturingPersonalProject.count({ where: { projectId: raced } }),
      ).resolves.toBe(1);
    });
  });

  describe("when an erased owner's personal-owner fact lands late", () => {
    /** @scenario "A personal-owner fact landing after the owner's erasure writes no owner row" */
    it("writes no row for them, and their erasure deleted the row they had", async () => {
      const owned = projectId("erased-owned");
      const late = projectId("erased-late");
      await personalProjects.recordOwner({ projectId: owned, organizationId, ownerUserId: erased });
      await personalProjects.forgetOwner({ ownerUserId: erased });

      await personalProjects.recordOwner({ projectId: owned, organizationId, ownerUserId: erased });
      await personalProjects.recordOwner({ projectId: late, organizationId, ownerUserId: erased });

      await expect(
        connection.client.nurturingPersonalProject.count({
          where: { organizationId, ownerUserId: erased },
        }),
      ).resolves.toBe(0);
    });
  });

  describe("when an owner's fact is redelivered after their erasure's mark but before its DELETE", () => {
    /** @scenario "A personal-owner fact landing while its owner's erasure commits leaves no owner row" */
    it("deletes the row the first delivery wrote", async () => {
      const owned = projectId("erased-mid-commit");
      const record = () =>
        personalProjects.recordOwner({
          projectId: owned,
          organizationId,
          ownerUserId: erasedMidCommit,
        });
      await record();
      // The erasure's mark has committed but its DELETE has not run, as when a fact read no mark
      // and wrote its row after that DELETE had passed.
      await connection.client.nurturingErasedUser.create({
        data: { userIdHash: erasedUserHashOf(erasedMidCommit) },
      });

      await record();

      await expect(personalProjects.findOwnerUserIds({ projectId: owned })).resolves.toEqual([]);
    });
  });

  describe("when a worker stops between a marked owner's write and its re-check", () => {
    /** @scenario "A personal-owner fact for a marked owner writes no row even if its re-check never runs" */
    it("rejects and leaves no row, the write itself having read the mark", async () => {
      const owned = projectId("erased-stopped");
      await PrismaNurturingErasedUserRepository.create({ prisma: connection.client }).markErased({
        userId: erasedStopped,
      });
      const stopping = PrismaNurturingPersonalProjectRepository.create({
        prisma: stoppedBeforeRecheck(connection.client),
      });

      await expect(
        stopping.recordOwner({ projectId: owned, organizationId, ownerUserId: erasedStopped }),
      ).rejects.toThrow("re-check");

      await expect(personalProjects.findOwnerUserIds({ projectId: owned })).resolves.toEqual([]);
    });
  });

  describe("when a project nurturing never recorded is asked for", () => {
    it("answers no owner", async () => {
      await expect(
        personalProjects.findOwnerUserIds({ projectId: projectId("unknown") }),
      ).resolves.toEqual([]);
    });
  });

  describe("when projects of an organization are recorded as traced, twice each", () => {
    /** @scenario "Trace's traced fact leaves one traced row for its organization" */
    it("keeps one row per project and answers the organization traced", async () => {
      const first = projectId("traced-1");
      const second = projectId("traced-2");

      for (const id of [first, first, second, second]) {
        await tracedProjects.recordTraced({ projectId: id, organizationId });
      }

      await expect(tracedProjects.hasTraced({ organizationId })).resolves.toBe(true);
      await expect(
        connection.client.nurturingTracedProject.count({ where: { organizationId } }),
      ).resolves.toBe(2);
    });
  });

  describe("when an organization has no traced project recorded", () => {
    it("answers it untraced", async () => {
      await expect(
        tracedProjects.hasTraced({ organizationId: `${organizationId}-untraced` }),
      ).resolves.toBe(false);
    });
  });
});
