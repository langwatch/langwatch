// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * @vitest-environment node
 * Nurturing counts against its own organizations; placement is the directory's (R40).
 * Spec: enterprise/modules/nurturing/specs/nurturing.feature
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

const databaseUrl = process.env.LANGWATCH_TEST_DATABASE_URL;
const organizationId = `test-nurturing-milestones-${randomUUID()}`;

describe.skipIf(!databaseUrl)("given nurturing's organizations table", () => {
  let connection: PrismaConnection;
  let repository: PrismaNurturingMilestonesRepository;

  beforeAll(() => {
    if (!databaseUrl) throw new Error("LANGWATCH_TEST_DATABASE_URL is required here");
    connection = PrismaConnectionService.create({
      guard: PrismaTenancyGuardService.create(),
      logger: createLogger("langwatch:nurturing:test:milestones"),
    }).connect(PrismaConfigService.create().resolve({ databaseUrl, log: ["error"] }));
    repository = PrismaNurturingMilestonesRepository.create({ prisma: connection.client });
  });

  afterAll(async () => {
    if (!connection) return;
    await connection.client.nurturingOrganization.deleteMany({ where: { organizationId } });
    await connection.closeOnce();
  });

  describe("when an evaluation is counted for an organization nurturing learned", () => {
    it("raises the organization's evaluation count by one", async () => {
      await repository.recordOrganization({ organizationId, adminUserId: null, seeded: false });

      await expect(repository.countEvaluation({ organizationId })).resolves.toMatchObject([
        { organizationId, seeded: false, evaluationCount: 1 },
      ]);
    });
  });

  describe("when two events record one organization at once", () => {
    it("resolves both and leaves one row", async () => {
      const raced = `${organizationId}-raced`;
      const input = { organizationId: raced, adminUserId: null, seeded: true };

      await expect(
        Promise.all(Array.from({ length: 5 }, () => repository.recordOrganization(input))),
      ).resolves.toHaveLength(5);

      await expect(
        connection.client.nurturingOrganization.findMany({ where: { organizationId: raced } }),
      ).resolves.toHaveLength(1);
      await connection.client.nurturingOrganization.deleteMany({
        where: { organizationId: raced },
      });
    });
  });

  describe("when the organization is one nurturing never learned", () => {
    it("counts nothing", async () => {
      await expect(
        repository.countEvaluation({ organizationId: `${organizationId}-absent` }),
      ).resolves.toEqual([]);
    });
  });
});
