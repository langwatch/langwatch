// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * @vitest-environment node
 * Nurturing's own copies of personal owners and traced projects, written from owners' facts.
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

import { PrismaNurturingPersonalProjectRepository } from "../prisma.nurturing-personal-project.repository.ts";
import { PrismaNurturingTracedProjectRepository } from "../prisma.nurturing-traced-project.repository.ts";

const databaseUrl = process.env.LANGWATCH_TEST_DATABASE_URL;
const run = randomUUID();
const organizationId = `test-nurturing-copies-${run}`;
const projectId = (name: string) => `test-nurturing-copies-${name}-${run}`;

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
