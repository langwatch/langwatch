/**
 * `ModelProviderEvidenceService.hasEnabledProvider` cascades PROJECT -> TEAM -> ORGANIZATION.
 * The unit test pins the WHERE clause shape against a mock; only real Postgres proves the
 * cascade resolves per scope level, since the mock returns the same row regardless of match.
 * @vitest-environment node
 * @see specs/home/onboarding-progress-backend.feature
 */
import { randomBytes } from "node:crypto";

import { createLogger } from "@langwatch/observability";
import {
  PrismaConfigService,
  PrismaConnectionService,
  PrismaTenancyGuardService,
  type PrismaConnection,
} from "@langwatch/prisma-client";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import { ProjectNotFoundError, type ProjectWithTeam } from "@langwatch/project-contract";
import { cleanupTestRows } from "@langwatch/test-harness/prisma";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { ModelCostProject } from "../app/model-provider.members.ts";
import { PrismaModelProviderEvidenceRepository } from "../repositories/prisma/prisma.model-provider-evidence.repository.ts";
import { ModelProviderEvidenceService } from "../services/model-provider-evidence.service.ts";
import { ModelProviderProjectScopeService } from "../services/model-provider-project-scope.service.ts";

const DB_URL = process.env.LANGWATCH_TEST_DATABASE_URL;

const testNamespace = `mpe-${randomBytes(5).toString("hex")}`;

/** Reads the real project + team row this integration suite created. */
class PrismaProjects extends ModelCostProject {
  constructor(private readonly prisma: PrismaClient) {
    super();
  }

  async findWithTeam(id: string): Promise<ProjectWithTeam | null> {
    const project = await this.prisma.project.findUnique({
      where: { id },
      include: { team: true },
    });
    return project as unknown as ProjectWithTeam | null;
  }

  async getWithTeam(id: string): Promise<ProjectWithTeam> {
    const project = await this.findWithTeam(id);
    if (!project) throw new ProjectNotFoundError();
    return project;
  }
}

describe.skipIf(!DB_URL)("given a project's model-provider cascade", () => {
  const connection: PrismaConnection = PrismaConnectionService.create({
    guard: PrismaTenancyGuardService.create(),
    logger: createLogger("model-provider-evidence-integration"),
  }).connect(PrismaConfigService.create().resolve({ databaseUrl: DB_URL ?? "", log: ["error"] }));
  const prisma = connection.client as PrismaClient;
  const evidence = ModelProviderEvidenceService.create({
    providers: PrismaModelProviderEvidenceRepository.create(prisma),
    scopes: ModelProviderProjectScopeService.create({ projects: new PrismaProjects(prisma) }),
  });

  let organizationId: string;
  let teamId: string;
  let projectId: string;
  const providerIds: string[] = [];

  beforeAll(async () => {
    const organization = await prisma.organization.create({
      data: { name: `ACME ${testNamespace}`, slug: `--test-org-${testNamespace}` },
    });
    organizationId = organization.id;

    const team = await prisma.team.create({
      data: { name: `ACME ${testNamespace}`, slug: `--test-team-${testNamespace}`, organizationId },
    });
    teamId = team.id;

    const project = await prisma.project.create({
      data: {
        name: "MP Evidence Project",
        slug: `--test-proj-${testNamespace}`,
        apiKey: `sk-lw-test-${randomBytes(12).toString("hex")}`,
        teamId,
        language: "en",
        framework: "test",
      },
    });
    projectId = project.id;
  });

  afterAll(async () => {
    if (!organizationId) return;
    await cleanupTestRows(prisma, [
      ["modelProviderScope", { modelProviderId: { in: providerIds } }],
      ["modelProvider", { id: { in: providerIds } }],
      ["project", { teamId }],
      ["team", { organizationId }],
      ["organization", { id: organizationId }],
    ]);
    await prisma.$disconnect();
  });

  /** @scenario Step setupModelProviders is complete for a project-scoped provider */
  it("is complete when a provider is scoped directly to the project", async () => {
    const provider = await prisma.modelProvider.create({
      data: {
        name: "Project OpenAI",
        provider: "openai",
        enabled: true,
        organizationId,
        scopes: { create: [{ scopeType: "PROJECT", scopeId: projectId }] },
      },
    });
    providerIds.push(provider.id);

    await expect(evidence.hasEnabledProvider({ projectId })).resolves.toBe(true);
  });

  /** @scenario Step setupModelProviders is complete for an organization-scoped provider */
  it("is complete when only an organization-scoped provider exists", async () => {
    const organization = await prisma.organization.create({
      data: { name: `Org-scoped ${testNamespace}`, slug: `--test-org-orgscope-${testNamespace}` },
    });
    const team = await prisma.team.create({
      data: {
        name: `Org-scoped ${testNamespace}`,
        slug: `--test-team-orgscope-${testNamespace}`,
        organizationId: organization.id,
      },
    });
    const project = await prisma.project.create({
      data: {
        name: "Org-scoped Project",
        slug: `--test-proj-orgscope-${testNamespace}`,
        apiKey: `sk-lw-test-${randomBytes(12).toString("hex")}`,
        teamId: team.id,
        language: "en",
        framework: "test",
      },
    });
    const provider = await prisma.modelProvider.create({
      data: {
        name: "Org OpenAI",
        provider: "openai",
        enabled: true,
        organizationId: organization.id,
        scopes: { create: [{ scopeType: "ORGANIZATION", scopeId: organization.id }] },
      },
    });

    try {
      await expect(evidence.hasEnabledProvider({ projectId: project.id })).resolves.toBe(true);
    } finally {
      await prisma.modelProviderScope.deleteMany({ where: { modelProviderId: provider.id } });
      await prisma.modelProvider.delete({ where: { id: provider.id } });
      await prisma.project.delete({ where: { id: project.id } });
      await prisma.team.delete({ where: { id: team.id } });
      await prisma.organization.delete({ where: { id: organization.id } });
    }
  });

  /** @scenario Step setupModelProviders is complete for a team-scoped provider */
  it("is complete when only a team-scoped provider exists", async () => {
    const provider = await prisma.modelProvider.create({
      data: {
        name: "Team OpenAI",
        provider: "openai",
        enabled: true,
        organizationId,
        scopes: { create: [{ scopeType: "TEAM", scopeId: teamId }] },
      },
    });
    providerIds.push(provider.id);

    await expect(evidence.hasEnabledProvider({ projectId })).resolves.toBe(true);
  });

  /** @scenario Step setupModelProviders ignores disabled providers */
  it("is incomplete when the only visible provider is disabled", async () => {
    const organization = await prisma.organization.create({
      data: { name: `Disabled ${testNamespace}`, slug: `--test-org-disabled-${testNamespace}` },
    });
    const team = await prisma.team.create({
      data: {
        name: `Disabled ${testNamespace}`,
        slug: `--test-team-disabled-${testNamespace}`,
        organizationId: organization.id,
      },
    });
    const project = await prisma.project.create({
      data: {
        name: "Disabled Provider Project",
        slug: `--test-proj-disabled-${testNamespace}`,
        apiKey: `sk-lw-test-${randomBytes(12).toString("hex")}`,
        teamId: team.id,
        language: "en",
        framework: "test",
      },
    });
    const provider = await prisma.modelProvider.create({
      data: {
        name: "Disabled OpenAI",
        provider: "openai",
        enabled: false,
        organizationId: organization.id,
        scopes: { create: [{ scopeType: "PROJECT", scopeId: project.id }] },
      },
    });

    try {
      await expect(evidence.hasEnabledProvider({ projectId: project.id })).resolves.toBe(false);
    } finally {
      await prisma.modelProviderScope.deleteMany({ where: { modelProviderId: provider.id } });
      await prisma.modelProvider.delete({ where: { id: provider.id } });
      await prisma.project.delete({ where: { id: project.id } });
      await prisma.team.delete({ where: { id: team.id } });
      await prisma.organization.delete({ where: { id: organization.id } });
    }
  });
});
