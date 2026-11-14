// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * @vitest-environment node
 * Nurturing's own copies of project placement and organization creation, from owner events.
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
import { PrismaNurturingProjectPlacementRepository } from "../prisma.nurturing-project-placement.repository.ts";

const databaseUrl = process.env.LANGWATCH_TEST_DATABASE_URL;
const namespace = `test-nurturing-placement-${randomUUID()}`;
const organizationId = `${namespace}-org`;
const otherOrganizationId = `${namespace}-other-org`;
const projectId = `${namespace}-project`;
const otherProjectId = `${namespace}-other-project`;

describe.skipIf(!databaseUrl)("given nurturing's own placement copies", () => {
  let connection: PrismaConnection;
  let placements: PrismaNurturingProjectPlacementRepository;
  let organizationsCreated: PrismaNurturingOrganizationCreatedRepository;

  beforeAll(() => {
    if (!databaseUrl) throw new Error("LANGWATCH_TEST_DATABASE_URL is required here");
    connection = PrismaConnectionService.create({
      guard: PrismaTenancyGuardService.create(),
      logger: createLogger("langwatch:nurturing:test:placement"),
    }).connect(PrismaConfigService.create().resolve({ databaseUrl, log: ["error"] }));
    placements = PrismaNurturingProjectPlacementRepository.create({ prisma: connection.client });
    organizationsCreated = PrismaNurturingOrganizationCreatedRepository.create({
      prisma: connection.client,
    });
  });

  afterAll(async () => {
    if (!connection) return;
    for (const id of [organizationId, otherOrganizationId]) {
      await connection.client.nurturingProject.deleteMany({ where: { organizationId: id } });
      await connection.client.nurturingOrganizationCreated.deleteMany({
        where: { organizationId: id },
      });
    }
    await connection.closeOnce();
  });

  /** @scenario "A created project is placed in its organization from the creation fact" */
  it("places a recorded project in its organization, the same on a redelivery", async () => {
    await placements.recordProject({ projectId, organizationId });
    await placements.recordProject({ projectId, organizationId });
    await placements.recordProject({
      projectId: otherProjectId,
      organizationId: otherOrganizationId,
    });

    await expect(placements.getPlacement({ projectId })).resolves.toEqual({
      outcome: "known",
      organizationId,
    });
    await expect(placements.findProjectIds({ organizationId })).resolves.toEqual([projectId]);
    await expect(placements.getPlacement({ projectId: `${namespace}-never` })).resolves.toEqual({
      outcome: "unknown",
    });
  });

  /** @scenario "The signup day comes from the organization's creation fact" */
  it("keeps the earliest creation time, whatever order the deliveries come in", async () => {
    await organizationsCreated.recordOrganizationCreated({ organizationId, createdAt: 5_000 });
    await organizationsCreated.recordOrganizationCreated({ organizationId, createdAt: 2_000 });
    await organizationsCreated.recordOrganizationCreated({ organizationId, createdAt: 9_000 });

    await expect(
      organizationsCreated.findOrganizationCreatedAt({ organizationId }),
    ).resolves.toEqual({ organizationCreatedAt: 2_000 });
    await expect(
      organizationsCreated.findOrganizationCreatedAt({ organizationId: otherOrganizationId }),
    ).resolves.toEqual({ organizationCreatedAt: null });
  });
});
