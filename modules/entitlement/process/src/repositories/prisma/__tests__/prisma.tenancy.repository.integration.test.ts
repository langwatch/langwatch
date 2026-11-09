/**
 * @vitest-environment node
 * The usage page names an organization's destination projects, never its aggregates.
 * @see ../../../../../../specs/licensing/usage-page.feature
 */
import { randomUUID } from "node:crypto";

import { createLogger } from "@langwatch/observability";
import {
  PrismaConfigService,
  PrismaConnectionService,
  PrismaTenancyGuardService,
  type PrismaConnection,
} from "@langwatch/prisma-client";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { PrismaTenancyRepository } from "../prisma.tenancy.repository.ts";

const DB_URL = process.env.LANGWATCH_TEST_DATABASE_URL;

describe.skipIf(!DB_URL)("PrismaTenancyRepository.findProjectNames", () => {
  const ns = `tenancy-names-${randomUUID().slice(0, 8)}`;
  let connection: PrismaConnection | undefined;
  let prisma: PrismaClient;
  let organizationId: string;
  let teamId: string;
  const projectIds: string[] = [];

  const createProject = async ({ name, kind }: { name: string; kind?: string }) => {
    const project = await prisma.project.create({
      data: {
        name,
        slug: `${name}-${ns}`,
        apiKey: `test-key-${name}-${ns}`,
        teamId,
        language: "python",
        framework: "openai",
        ...(kind ? { kind } : {}),
      },
    });
    projectIds.push(project.id);
    return project.id;
  };

  beforeAll(async () => {
    connection = PrismaConnectionService.create({
      guard: PrismaTenancyGuardService.create(),
      logger: createLogger("langwatch:entitlement:test:tenancy-repository"),
    }).connect(PrismaConfigService.create().resolve({ databaseUrl: DB_URL ?? "", log: ["error"] }));
    prisma = connection.client as PrismaClient;
    organizationId = (
      await prisma.organization.create({ data: { name: `Org ${ns}`, slug: `org-${ns}` } })
    ).id;
    teamId = (
      await prisma.team.create({ data: { name: `Team ${ns}`, slug: `team-${ns}`, organizationId } })
    ).id;
  });

  afterAll(async () => {
    if (!connection) return;
    try {
      await prisma.project.deleteMany({ where: { id: { in: projectIds } } });
      await prisma.team.deleteMany({ where: { id: teamId } });
      await prisma.organization.deleteMany({ where: { id: organizationId } });
    } finally {
      await prisma.$disconnect();
    }
  });

  /** @scenario "Each project's share of the month is listed, the busiest first" */
  it("names the destination projects by name and leaves the aggregate out", async () => {
    const triage = await createProject({ name: "triage" });
    const support = await createProject({ name: "support-agent" });
    await createProject({ name: "rollup", kind: "aggregate" });

    const names = await PrismaTenancyRepository.create(prisma).findProjectNames({ organizationId });

    expect(names).toEqual([
      { id: support, name: "support-agent" },
      { id: triage, name: "triage" },
    ]);
  });
});
