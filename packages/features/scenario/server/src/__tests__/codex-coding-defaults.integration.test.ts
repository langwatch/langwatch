/**
 * @vitest-environment node
 * @integration
 *
 * A project whose FAST / coding-default role is pinned to a codex model must
 * still be able to run scenario simulations against workflow / code / http
 * targets.
 *
 * The bug this guards: the prefetcher used to resolve an adapter-role model
 * for every target type, even though workflow / code / http targets never
 * consume an LLM key for the agent under test. A project that ran the Codex
 * "apply coding defaults" action — which pins FAST to a codex model —
 * therefore had every non-prompt simulation refused by the codex execution
 * backstop.
 *
 * The model-provider boundary is the REAL service here, composed over the
 * real Postgres repositories: the FAST and DEFAULT role rows are read back
 * from `ModelDefaultConfig`, and `prepareExecution` is the production path
 * that raises `ModelRestrictedForExecutionError` for a codex model. Faking
 * that boundary would hide exactly the failure this file exists to catch.
 *
 * @see specs/model-providers/codex-account-provider.feature
 */
import { randomBytes } from "node:crypto";
import type { Agent } from "@langwatch/agent-contract";
import type { AuthzService } from "@langwatch/authz-contract";
import { CODEX_DEFAULT_MODEL } from "@langwatch/model-provider-contract";
import {
  CodexTokenRefresher,
  ModelProviderConnectionRateLimiter,
  ModelProviderCredentialCodec,
  PostgresModelProviderAdapter,
  PrefixedModelProviderIdAdapter,
  RegistryModelProviderCatalogAdapter,
  UnavailableModelProviderCredentialProbeAdapter,
  UnmanagedModelProviderGatewayAdapter,
  VercelAiModelTranslationAdapter,
} from "@langwatch/model-provider-server";
import type { ModelProviderService } from "@langwatch/model-provider-contract";
import type { OrganizationService } from "@langwatch/organization-contract";
import {
  PrismaConfigService,
  PrismaConnectionService,
  PrismaQueryGuard,
  type PrismaQueryContext,
  type PrismaQueryExecutor,
} from "@langwatch/prisma-client";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import type { ProjectService } from "@langwatch/project-contract";
import type { TargetConfig } from "@langwatch/scenario-contract";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  createTestScenarioExecutionPrefetcherService,
  type ScenarioPrefetchFixture,
} from "./support/scenario-execution-prefetcher.fixture";

const DEFAULT_ROLE_MODEL = "openai/gpt-5-mini";

class AllowTestQueries extends PrismaQueryGuard {
  execute(context: PrismaQueryContext, next: PrismaQueryExecutor): Promise<unknown> {
    return next(context.args);
  }
}

/** Round-trips credentials as plain JSON — nothing here asserts on ciphertext. */
class IdentityCredentialCodec extends ModelProviderCredentialCodec {
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

class UnusedCodexTokenRefresher extends CodexTokenRefresher {
  refresh(): Promise<never> {
    throw new Error("no codex token refresh is expected in this suite");
  }
}

class UnlimitedConnections extends ModelProviderConnectionRateLimiter {
  async assertAvailable(): Promise<void> {}
}

const databaseUrl = process.env.LANGWATCH_TEST_DATABASE_URL ?? process.env.DATABASE_URL;
const connection = databaseUrl
  ? PrismaConnectionService.create({ guard: new AllowTestQueries() }).connect(
      PrismaConfigService.create().resolve({ databaseUrl, log: ["error"] }),
    )
  : null;

function database(): PrismaClient {
  if (connection === null) throw new Error("a database URL is required for this suite");
  return connection.client as PrismaClient;
}

/** The real service, over the real repositories, with only the outbound edges stood down. */
function realModelProviders(prisma: PrismaClient): ModelProviderService {
  return PostgresModelProviderAdapter.create({
    database: prisma,
    projects: {
      tryGetWithTeam: async (id: string) =>
        await prisma.project.findUnique({ where: { id }, include: { team: true } }),
      getWithTeam: async (id: string) => {
        const project = await prisma.project.findUnique({
          where: { id },
          include: { team: true },
        });
        if (!project) throw new Error(`project ${id} not found`);
        return project;
      },
      listIdsByOrganization: async ({ organizationId }: { organizationId: string }) => {
        const rows = await prisma.project.findMany({
          where: { team: { organizationId } },
          select: { id: true },
        });
        return rows.map((row) => row.id);
      },
      listNamesByIds: async ({ projectIds }: { projectIds: string[] }) => {
        const rows = await prisma.project.findMany({
          where: { id: { in: projectIds } },
          include: { team: true },
        });
        return rows.map((row) => ({
          id: row.id,
          name: row.name,
          slug: row.slug,
          teamId: row.teamId,
          organizationId: row.team.organizationId,
          isPersonal: row.isPersonal,
          ownerUserId: row.ownerUserId,
        }));
      },
    } as unknown as ProjectService,
    organizations: {
      getBillingProfile: async ({ organizationId }: { organizationId: string }) => {
        const organization = await prisma.organization.findUnique({
          where: { id: organizationId },
        });
        if (!organization) throw new Error(`organization ${organizationId} not found`);
        return organization;
      },
      listTeams: async ({ organizationId }: { organizationId: string }) => {
        const data = await prisma.team.findMany({ where: { organizationId } });
        return { data, pagination: { page: 1, limit: data.length, total: data.length } };
      },
    } as unknown as OrganizationService,
    authorization: { getDecision: async () => ({ permitted: true }) } as unknown as AuthzService,
    credentials: new IdentityCredentialCodec(),
    codexTokenRefresher: new UnusedCodexTokenRefresher(),
    connectionRateLimiter: new UnlimitedConnections(),
    catalog: RegistryModelProviderCatalogAdapter.create({
      managed: UnmanagedModelProviderGatewayAdapter.create(),
      probe: UnavailableModelProviderCredentialProbeAdapter.create(),
      systemProviderEnvironment: {},
      isSaas: false,
    }),
    translation: VercelAiModelTranslationAdapter.create({
      projects: {} as unknown as ProjectService,
      executionProxyBaseUrl: "http://langwatch_nlp:5561/go/proxy/v1",
    }),
    ids: PrefixedModelProviderIdAdapter.create({
      suffix: () => randomBytes(6).toString("hex"),
    }),
  }).build();
}

describe.skipIf(!databaseUrl)("given a project whose FAST role default is a codex model", () => {
  const ns = `codex-coding-${randomBytes(5).toString("hex")}`;
  const prisma = database();

  let organizationId: string;
  let teamId: string;
  let projectId: string;
  let userId: string;
  let modelProviders: ModelProviderService;

  beforeAll(async () => {
    const organization = await prisma.organization.create({
      data: { name: `Codex Coding Org ${ns}`, slug: `--test-${ns}` },
    });
    organizationId = organization.id;
    const team = await prisma.team.create({
      data: { name: `Team ${ns}`, slug: `--team-${ns}`, organizationId },
    });
    teamId = team.id;
    const project = await prisma.project.create({
      data: {
        name: `Project ${ns}`,
        slug: `--proj-${ns}`,
        teamId,
        language: "typescript",
        framework: "other",
        apiKey: `test-platform-key-${ns}`,
      },
    });
    projectId = project.id;
    const user = await prisma.user.create({
      data: { name: "Codex Coding Test User", email: `${ns}@example.com` },
    });
    userId = user.id;

    modelProviders = realModelProviders(prisma);

    // A real, enabled OpenAI provider so the DEFAULT role — which the
    // simulator and judge always resolve — has real execution parameters.
    await modelProviders.upsert({
      projectId,
      provider: "openai",
      enabled: true,
      customKeys: { OPENAI_API_KEY: `sk-openai-${ns}` },
      scopes: [{ scopeType: "PROJECT", scopeId: projectId }],
    });
    // A real, enabled Codex provider, so a regression reproduces the
    // REPORTED failure (the execution backstop) rather than a different
    // one like "provider not found" that would also mark a prefetch
    // unsuccessful.
    await modelProviders.upsert({
      projectId,
      provider: "openai_codex",
      enabled: true,
      customKeys: {
        CODEX_ACCESS_TOKEN: `codex-access-${ns}`,
        CODEX_REFRESH_TOKEN: `codex-refresh-${ns}`,
        CODEX_ID_TOKEN: `codex-id-token-${ns}`,
        CODEX_ACCOUNT_ID: `codex-account-${ns}`,
        CODEX_PLAN: "pro",
        CODEX_EMAIL: `${ns}@example.com`,
        CODEX_TOKENS_SAVED_AT: new Date().toISOString(),
      },
      scopes: [{ scopeType: "PROJECT", scopeId: projectId }],
    });

    // Exactly the pair "apply coding defaults" writes for FAST, plus a
    // DEFAULT-role default so the simulator and judge resolve.
    await modelProviders.setDefault({
      scope: { scopeType: "PROJECT", scopeId: projectId },
      key: "DEFAULT",
      model: DEFAULT_ROLE_MODEL,
      authorId: userId,
    });
    await modelProviders.setDefault({
      scope: { scopeType: "PROJECT", scopeId: projectId },
      key: "FAST",
      model: CODEX_DEFAULT_MODEL,
      authorId: userId,
    });
  }, 60_000);

  afterAll(async () => {
    if (!projectId) return;
    const providerIds = (
      await prisma.modelProvider.findMany({ where: { organizationId }, select: { id: true } })
    ).map((row) => row.id);
    await prisma.modelProviderScope.deleteMany({
      where: { modelProviderId: { in: providerIds } },
    });
    await prisma.modelProvider.deleteMany({ where: { organizationId } });
    await prisma.modelDefaultConfig.deleteMany({ where: { organizationId } });
    await prisma.project.deleteMany({ where: { teamId } });
    await prisma.team.deleteMany({ where: { id: teamId } });
    await prisma.organization.deleteMany({ where: { id: organizationId } });
    await prisma.user.deleteMany({ where: { id: userId } });
  });

  const httpAgent: Agent = {
    id: "agent_http",
    type: "http" as const,
    name: "HTTP agent",
    config: { url: "https://example.com/chat", method: "POST", headers: [] },
    projectId: "",
    workflowId: null,
    copiedFromAgentId: null,
    createdAt: new Date(0),
    updatedAt: new Date(0),
    archivedAt: null,
  };
  const codeAgent: Agent = {
    id: "agent_code",
    type: "code" as const,
    name: "Code agent",
    config: {
      parameters: [
        { identifier: "code", type: "code", value: "def execute(input):\n    return input" },
      ],
      inputs: [{ identifier: "input", type: "str" }],
      outputs: [{ identifier: "output", type: "str" }],
    },
    projectId: "",
    workflowId: null,
    copiedFromAgentId: null,
    createdAt: new Date(0),
    updatedAt: new Date(0),
    archivedAt: null,
  };
  const workflowAgent: Agent = {
    id: "agent_workflow",
    type: "workflow" as const,
    name: "Workflow agent",
    config: { workflow_id: "wf_codex" },
    projectId: "",
    workflowId: "wf_codex",
    copiedFromAgentId: null,
    createdAt: new Date(0),
    updatedAt: new Date(0),
    archivedAt: null,
  };

  function fixtureFor(agent: Agent) {
    return {
      scenarioFetcher: {
        getById: async () => ({
          id: "scen_codex",
          name: "Codex coding defaults scenario",
          situation: "User asks a question",
          criteria: ["Responds politely"],
          labels: [],
        }),
      },
      suiteConfigFetcher: { getBySetId: async () => null },
      promptFetcher: { tryGetPromptByIdOrHandle: async () => null },
      agentFetcher: { findById: async () => ({ ...agent, projectId }) },
      workflowVersionFetcher: {
        getLatestDsl: async () => ({
          workflowId: "wf_codex",
          dsl: { spec_version: "1.5", nodes: [], edges: [] },
        }),
      },
      projectFetcher: { findUnique: async () => ({ apiKey: `test-platform-key-${ns}` }) },
      // Never consulted: `modelProviders` below replaces the stand-in these feed.
      modelParamsProvider: {
        prepare: async () => {
          throw new Error("the real model-provider service answers here");
        },
      },
      modelResolver: {
        resolve: async () => {
          throw new Error("the real model-provider service answers here");
        },
      },
      projectSecretsFetcher: { getSecrets: async () => ({}) },
      traceWaitBudgetResolver: { resolveTraceWaitTimeoutMs: async () => 1_000 },
      modelProviders,
    } satisfies ScenarioPrefetchFixture;
  }

  const cases: Array<{
    label: "workflow" | "code" | "http";
    agent: Agent;
  }> = [
    { label: "workflow", agent: workflowAgent },
    { label: "code", agent: codeAgent },
    { label: "http", agent: httpAgent },
  ];

  describe("when the codex model is asked to execute directly", () => {
    // The premise the three cases below rest on: this composition really does
    // carry the production backstop, so a prefetch that resolved the FAST
    // role for a non-prompt target would be refused rather than pass silently.
    it("is refused by the coding-assistant backstop", async () => {
      await expect(
        modelProviders.prepareExecution({ projectId, model: CODEX_DEFAULT_MODEL }),
      ).rejects.toThrow(/coding-assistant surfaces only/);
    });
  });

  describe.each(cases)("when the run is prefetched for a $label target", ({ label, agent }) => {
    /** @scenario Coding defaults never break a simulation run */
    it("prefetches successfully instead of hitting the codex coding-assistant backstop", async () => {
      const target: TargetConfig = { type: label, referenceId: agent.id };

      const result = await createTestScenarioExecutionPrefetcherService(fixtureFor(agent), {
        langwatchEndpoint: "http://app:5560",
        nlpServiceUrl: "http://langwatch_nlp:5561",
        legacyDefaultModel: DEFAULT_ROLE_MODEL,
      }).prefetch({
        context: {
          projectId,
          scenarioId: "scen_codex",
          setId: `set_${ns}_${label}`,
          batchRunId: `batch_${ns}_${label}`,
        },
        target,
      });

      expect(
        result.success,
        `prefetch failed for ${label} target: ${result.success ? "" : result.error}`,
      ).toBe(true);
    });
  });
});
