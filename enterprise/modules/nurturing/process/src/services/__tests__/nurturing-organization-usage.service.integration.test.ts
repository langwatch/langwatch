// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * @vitest-environment node
 * The usage mirror over nurturing's member copy and erasure marks in Postgres: a member row the
 * marks name an erased person by gets no identify, however the row outlived the erasure.
 * Spec: enterprise/modules/nurturing/specs/project-usage.feature
 */
import { randomUUID } from "node:crypto";

import type { CioBatchCall } from "@langwatch/enterprise-nurturing-contract";
import { createLogger } from "@langwatch/observability";
import {
  PrismaConfigService,
  PrismaConnectionService,
  PrismaTenancyGuardService,
  type PrismaConnection,
} from "@langwatch/prisma-client";
import { createTestLogger } from "@langwatch/test-harness";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { MemoryNurturingEvaluationDayRepository } from "../../repositories/memory/memory.nurturing-evaluation-day.repository.ts";
import { MemoryNurturingMilestonesRepository } from "../../repositories/memory/memory.nurturing-milestones.repository.ts";
import { MemoryNurturingOrganizationCreatedRepository } from "../../repositories/memory/memory.nurturing-organization-created.repository.ts";
import { MemoryNurturingProjectPlacementRepository } from "../../repositories/memory/memory.nurturing-project-placement.repository.ts";
import { MemoryNurturingProjectUsageRepository } from "../../repositories/memory/memory.nurturing-project-usage.repository.ts";
import { MemoryNurturingTraceDayRepository } from "../../repositories/memory/memory.nurturing-trace-day.repository.ts";
import { MemoryNurturingClaimRepository } from "../../repositories/memory/memory.nurturing.repositories.ts";
import { PrismaNurturingErasedUserRepository } from "../../repositories/prisma/prisma.nurturing-erased-user.repository.ts";
import { PrismaNurturingOrganizationMemberRepository } from "../../repositories/prisma/prisma.nurturing-organization-member.repository.ts";
import { erasedUserHashOf } from "../../rules/nurturing-virtual-key.rules.ts";
import { NurturingCopiedProjectsService } from "../nurturing-copied-projects.service.ts";
import { NurturingOrganizationUsageService } from "../nurturing-organization-usage.service.ts";

const databaseUrl = process.env.LANGWATCH_TEST_DATABASE_URL;
const namespace = `test-nurturing-usage-erased-${randomUUID()}`;
const organizationId = `${namespace}-org`;
const projectId = `${namespace}-project`;
const kept = `${namespace}-kept`;
const erased = `${namespace}-erased`;
const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 10, 20, 12);

describe.skipIf(!databaseUrl)("given a member row in Postgres naming a person since erased", () => {
  let connection: PrismaConnection;

  beforeAll(() => {
    if (!databaseUrl) throw new Error("LANGWATCH_TEST_DATABASE_URL is required here");
    connection = PrismaConnectionService.create({
      guard: PrismaTenancyGuardService.create(),
      logger: createLogger("langwatch:nurturing:test:usage-erased"),
    }).connect(PrismaConfigService.create().resolve({ databaseUrl, log: ["error"] }));
  });

  afterAll(async () => {
    if (!connection) return;
    await connection.client.nurturingOrganizationMember.deleteMany({ where: { organizationId } });
    await connection.client.nurturingErasedUser.deleteMany({
      where: { userIdHash: erasedUserHashOf(erased) },
    });
    await connection.closeOnce();
  });

  describe("when the organization's usage syncs", () => {
    /** @scenario "A member row left naming an erased person gets no usage identify" */
    it("identifies the other member and never the erased one", async () => {
      const members = PrismaNurturingOrganizationMemberRepository.create({
        prisma: connection.client,
      });
      for (const userId of [kept, erased]) {
        await members.recordMembershipChange({ organizationId, userId, change: "joined", at: 1 });
      }
      // The mark alone, as a worker stopped before the erasure deleted the row would leave it.
      await connection.client.nurturingErasedUser.create({
        data: { userIdHash: erasedUserHashOf(erased) },
      });
      const milestones = MemoryNurturingMilestonesRepository.create();
      await milestones.recordOrganization({ organizationId, adminUserId: kept, seeded: false });
      const placements = MemoryNurturingProjectPlacementRepository.create({
        placed: new Map([[projectId, organizationId]]),
      });
      const organizationsCreated = MemoryNurturingOrganizationCreatedRepository.create({
        createdAt: new Map([[organizationId, NOW - DAY_MS]]),
      });
      const sent: CioBatchCall[] = [];
      const usage = NurturingOrganizationUsageService.create({
        projectUsage: MemoryNurturingProjectUsageRepository.create(),
        traceDays: MemoryNurturingTraceDayRepository.create(),
        evaluationDays: MemoryNurturingEvaluationDayRepository.create(),
        copiedProjects: NurturingCopiedProjectsService.create({ placements, organizationsCreated }),
        placements,
        organizationsCreated,
        milestones,
        members,
        erasedUsers: PrismaNurturingErasedUserRepository.create({ prisma: connection.client }),
        claims: MemoryNurturingClaimRepository.create(),
        sendBatch: async (calls) => void sent.push(...calls),
        clock: { nowMs: () => NOW },
        logger: createTestLogger().logger,
        syncs: { inc: () => {} },
      });

      await usage.usageChanged({ projectId });

      expect(sent.map(({ type, userId }) => [type, userId])).toEqual([
        ["group", kept],
        ["identify", kept],
      ]);
    });
  });
});
