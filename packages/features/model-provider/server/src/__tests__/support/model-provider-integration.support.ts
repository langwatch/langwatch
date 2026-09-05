/**
 * Shared real-Postgres fixtures for the model-provider integration suites.
 */
import { randomBytes } from "node:crypto";
import {
  PrismaConfigService,
  PrismaConnectionService,
  PrismaTenancyGuardService,
} from "@langwatch/prisma-client";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import {
  ProjectService,
  type PaginatedProjects,
  type Project,
  type ProjectIdentity,
  type ProjectIdsByOrganizationInput,
  type ProjectNamesByIdsInput,
  type ProjectWithTeam,
} from "@langwatch/project-contract";
import type {
  ModelDefaultScope,
  ModelProvider,
  ModelProviderApiKeyValidation,
  ModelProviderCredentialVerdict,
} from "@langwatch/model-provider-contract";
import {
  ModelProviderCatalog,
  ModelProviderCredentialCodec,
} from "../../ports/model-provider.port";
import { PrefixedModelProviderIdAdapter } from "../../adapters/prefixed.model-provider-id.adapter";

export const DB_URL = process.env.LANGWATCH_TEST_DATABASE_URL;

/** A real Postgres-backed Prisma client, gated the same way as the rest of the suite. */
export function createTestPrismaClient(): PrismaClient {
  const connection = PrismaConnectionService.create({
    guard: PrismaTenancyGuardService.create(),
  }).connect(PrismaConfigService.create().resolve({ databaseUrl: DB_URL ?? "", log: ["error"] }));
  return connection.client as PrismaClient;
}

export function testNamespace(prefix: string): string {
  return `${prefix}-${randomBytes(5).toString("hex")}`;
}

const notImplemented = (): never => {
  throw new Error("not implemented in this test fixture");
};

/**
 * Reads real project + team rows this integration suite created.
 */
export class PrismaProjects extends ProjectService {
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

  async listByOrganization(input: {
    organizationId: string;
    page: number;
    limit: number;
    projectIds?: string[];
  }): Promise<PaginatedProjects> {
    const where = {
      team: { organizationId: input.organizationId },
      ...(input.projectIds ? { id: { in: input.projectIds } } : {}),
    };
    const [data, total] = await Promise.all([
      this.prisma.project.findMany({
        where,
        skip: (input.page - 1) * input.limit,
        take: input.limit,
      }),
      this.prisma.project.count({ where }),
    ]);
    return {
      data: data as unknown as Project[],
      pagination: { page: input.page, limit: input.limit, total },
    };
  }

  async listIdsByOrganization(input: ProjectIdsByOrganizationInput): Promise<string[]> {
    const rows = await this.prisma.project.findMany({
      where: { team: { organizationId: input.organizationId } },
      select: { id: true },
    });
    return rows.map((row) => row.id);
  }

  async listNamesByIds(input: ProjectNamesByIdsInput): Promise<ProjectIdentity[]> {
    const rows = await this.prisma.project.findMany({
      where: { id: { in: input.projectIds } },
      include: { team: true },
    });
    return rows.map(
      (row) =>
        ({
          id: row.id,
          name: row.name,
          slug: row.slug,
          teamId: row.teamId,
          organizationId: row.team.organizationId,
          isPersonal: row.isPersonal,
          ownerUserId: row.ownerUserId,
        }) satisfies ProjectIdentity,
    );
  }

  tryFindInternal = notImplemented;
  ensureInternal = notImplemented;
  isPresenceEnabled = notImplemented;
  getById = notImplemented;
  tryGetIdentity = notImplemented;
  getOrganizationId = notImplemented;
  tryGetOrganizationId = notImplemented;
  tryGetById = notImplemented;
  tryGetSummaryById = notImplemented;
  create = notImplemented;
  update = notImplemented;
  archive = notImplemented;
  listByTeam = notImplemented;
  listActiveByScopes = notImplemented;
  updateMetadata = notImplemented;
  touchCodingAgentSessionSeen = notImplemented;
  touchCodingAgentPullRequestSeen = notImplemented;
  searchByQuery = notImplemented;
  tryGetTraceSharingConfig = notImplemented;
  resolveOrgAdmin = notImplemented;
  resolveTraceDestination = notImplemented;
  tryGetTraceDestination = notImplemented;
  listTraceDestinations = notImplemented;
}

/** Round-trips credentials as plain JSON — the tests below never assert on ciphertext shape. */
export class IdentityModelProviderCredentialCodec extends ModelProviderCredentialCodec {
  encode(value: Record<string, unknown> | null): unknown {
    return value ? JSON.stringify(value) : null;
  }

  tryDecode(value: unknown): Record<string, unknown> | null {
    if (typeof value !== "string") return (value as Record<string, unknown> | null) ?? null;
    try {
      return JSON.parse(value) as Record<string, unknown>;
    } catch {
      return null;
    }
  }
}

export type TenancyFixture = {
  organizationId: string;
  teamId: string;
  projectId: string;
  adminUserId: string;
};

/** Creates an organization + team + project + an org-admin user, all under one namespace. */
export async function createTenancyFixture(
  prisma: PrismaClient,
  ns: string,
): Promise<TenancyFixture> {
  const organization = await prisma.organization.create({
    data: { name: `ACME ${ns}`, slug: `--test-org-${ns}` },
  });
  const team = await prisma.team.create({
    data: { name: `ACME ${ns}`, slug: `--test-team-${ns}`, organizationId: organization.id },
  });
  const project = await prisma.project.create({
    data: {
      name: `ACME Project ${ns}`,
      slug: `--test-proj-${ns}`,
      apiKey: `sk-lw-test-${randomBytes(12).toString("hex")}`,
      teamId: team.id,
      language: "en",
      framework: "test",
    },
  });
  const admin = await prisma.user.create({
    data: { name: `Admin ${ns}`, email: `admin-${ns}@example.com` },
  });
  await prisma.organizationUser.create({
    data: { userId: admin.id, organizationId: organization.id, role: "ADMIN" },
  });
  await prisma.roleBinding.create({
    data: {
      organizationId: organization.id,
      userId: admin.id,
      role: "ADMIN",
      scopeType: "ORGANIZATION",
      scopeId: organization.id,
    },
  });

  return {
    organizationId: organization.id,
    teamId: team.id,
    projectId: project.id,
    adminUserId: admin.id,
  };
}

/** Fills in every field `PrismaModelProviderRepository.create` needs, defaults untouched by the test. */
export function buildModelProvider(overrides: {
  organizationId: string;
  provider: string;
  name: string;
  scopes: ModelDefaultScope[];
  customKeys?: Record<string, unknown> | null;
  id?: string;
  enabled?: boolean;
}): ModelProvider {
  const now = new Date();
  return {
    id: overrides.id ?? `mp-${randomBytes(8).toString("hex")}`,
    organizationId: overrides.organizationId,
    provider: overrides.provider,
    name: overrides.name,
    enabled: overrides.enabled ?? true,
    routingHandle: null,
    scopes: overrides.scopes.map((s) => ({ scopeType: s.scopeType, scopeId: s.scopeId })),
    customKeys: overrides.customKeys ?? null,
    customModels: [],
    customEmbeddingsModels: [],
    extraHeaders: [],
    rateLimitRpm: null,
    rateLimitTpm: null,
    rateLimitRpd: null,
    fallbackPriorityGlobal: null,
    providerConfig: null,
    createdAt: now,
    updatedAt: now,
  } as ModelProvider;
}

export const idService = PrefixedModelProviderIdAdapter.create({
  suffix: () => randomBytes(6).toString("hex"),
});

/** No-op collaborators the write path calls but these suites never exercise. */
export const noopConnectionRateLimiter = { assertAvailable: async () => {} };
export const noopOnboardingDefaults = { seed: async () => {} };

/**
 * A real `ModelProviderCatalog` (routing-handle rules, model metadata, static cost rates
 * all come from the base class) with only the network-touching verdict controllable, so a
 * probe test can assert whether it fired without a real outbound request.
 */
export class TestModelProviderCatalog extends ModelProviderCatalog {
  testConnectionCalls: Array<{ provider: string; customKeys: Record<string, unknown> }> = [];
  private readonly verdict: ModelProviderCredentialVerdict;

  constructor(verdict: ModelProviderCredentialVerdict = { state: "valid" } as never) {
    super();
    this.verdict = verdict;
  }

  systemProviders(): Promise<never[]> {
    return Promise.resolve([]);
  }

  validateApiKey(): Promise<ModelProviderApiKeyValidation> {
    return Promise.resolve({ valid: true } as never);
  }

  testConnection(
    provider: string,
    customKeys: Record<string, unknown>,
  ): Promise<ModelProviderCredentialVerdict> {
    this.testConnectionCalls.push({ provider, customKeys });
    return Promise.resolve(this.verdict);
  }

  tryGetExecutionValue(input: {
    customKeys: Record<string, unknown> | null;
    key: string;
  }): string | null {
    const stored = input.customKeys?.[input.key];
    return typeof stored === "string" && stored.length > 0 ? stored : null;
  }
}

export async function cleanupTenancyFixture(
  prisma: PrismaClient,
  fixture: TenancyFixture,
): Promise<void> {
  const providerIds = (
    await prisma.modelProvider.findMany({
      where: { organizationId: fixture.organizationId },
      select: { id: true },
    })
  ).map((p) => p.id);
  await prisma.modelProviderScope.deleteMany({ where: { modelProviderId: { in: providerIds } } });
  await prisma.modelProvider.deleteMany({ where: { organizationId: fixture.organizationId } });
  await prisma.modelDefaultConfig.deleteMany({ where: { organizationId: fixture.organizationId } });
  await prisma.roleBinding.deleteMany({ where: { organizationId: fixture.organizationId } });
  await prisma.organizationUser.deleteMany({ where: { organizationId: fixture.organizationId } });
  await prisma.project.deleteMany({ where: { teamId: fixture.teamId } });
  await prisma.team.deleteMany({ where: { organizationId: fixture.organizationId } });
  await prisma.organization.deleteMany({ where: { id: fixture.organizationId } });
  await prisma.user.deleteMany({ where: { id: fixture.adminUserId } });
}
