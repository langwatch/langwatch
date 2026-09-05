/**
 * @vitest-environment node
 *
 * @see specs/home/onboarding-progress-backend.feature
 *
 * The setup checklist's `setupModelProviders` step reads
 * `ModelProviderEvidenceService.hasEnabledProvider`, which cascades
 * PROJECT -> TEAM -> ORGANIZATION: a provider attached anywhere in that chain
 * counts, and a disabled one never does. `model-provider-evidence.service.unit.test.ts`
 * pins the WHERE clause shape against a mocked Prisma client; only a real
 * Postgres proves the cascade actually resolves per scope level, since the
 * mock returns the same row regardless of which scope matched.
 *
 * Requires LANGWATCH_TEST_DATABASE_URL. Skips cleanly without it.
 */
import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  PrismaConfigService,
  PrismaConnectionService,
  PrismaTenancyGuardService,
  type PrismaConnection,
} from "@langwatch/prisma-client";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import type { ProjectWithTeam } from "@langwatch/project-contract";
import { PostgresModelProviderEvidenceAdapter } from "../adapters/postgres.model-provider-evidence.adapter";
import { ModelCostProjectPort } from "../ports/model-provider.port";

const DB_URL = process.env.LANGWATCH_TEST_DATABASE_URL;

const testNamespace = `mpe-${randomBytes(5).toString("hex")}`;

/** Reads the real project + team row this integration suite created. */
class PrismaProjects extends ModelCostProjectPort {
  constructor(private readonly prisma: PrismaClient) {
    super();
  }

  async tryGetWithTeam(id: string): Promise<ProjectWithTeam | null> {
    const project = await this.prisma.project.findUnique({
      where: { id },
      include: { team: true },
    });
    return project as unknown as ProjectWithTeam | null;
  }

  async getWithTeam(id: string): Promise<ProjectWithTeam> {
    const project = await this.tryGetWithTeam(id);
    if (!project) throw new Error("no project");
    return project;
  }
}

describe.skipIf(!DB_URL)("given a project's model-provider cascade", () => {
  const connection: PrismaConnection = PrismaConnectionService.create({
    guard: PrismaTenancyGuardService.create(),
  }).connect(PrismaConfigService.create().resolve({ databaseUrl: DB_URL ?? "", log: ["error"] }));
  const prisma = connection.client as PrismaClient;
  const evidence = PostgresModelProviderEvidenceAdapter.create({
    database: prisma,
    projects: new PrismaProjects(prisma),
  }).build();

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
    await prisma.modelProviderScope.deleteMany({ where: { modelProviderId: { in: providerIds } } });
    await prisma.modelProvider.deleteMany({ where: { id: { in: providerIds } } });
    await prisma.project.deleteMany({ where: { teamId } });
    await prisma.team.deleteMany({ where: { organizationId } });
    await prisma.organization.deleteMany({ where: { id: organizationId } });
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
