/**
 * @vitest-environment node
 *
 * Which providers a virtual key actually dispatches to, and why the ones it
 * does not were dropped — against real Postgres.
 *
 * Three rules meet in the bundle. A routing policy narrows the chain to the
 * providers it names. A key's own allowlist narrows within that set and cannot
 * widen past it. And a safety-type provider holds evaluator credentials rather
 * than a chat door, so it is never dispatchable at all. The bundle also has to
 * say which providers each of the first two rules dropped, because that is the
 * only way the gateway can name a reason instead of a bare "no provider".
 *
 * Spec: specs/ai-gateway/governance/vk-provider-access.feature
 *       specs/ai-gateway/model-provider-scoping.feature
 */
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  PrismaConfigService,
  PrismaConnectionService,
  PrismaQueryGuard,
  type PrismaQueryContext,
  type PrismaQueryExecutor,
} from "@langwatch/prisma-client";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import type { ProjectService } from "@langwatch/project-contract";

import { PrismaGatewayAdapter } from "../adapters/prisma.gateway.adapter";
import type { GatewayModelProviderCredentialsPort } from "../ports/gateway-model-provider-credentials.port";
import { PrismaGatewayVirtualKeyRepository } from "../repositories/prisma/prisma.virtual-key.repository";
import { GatewayConfigMaterialiserService } from "../services/gateway-config-materialisation.service";
import type { GatewayService } from "../services/gateway.service";
import { TestProjectService } from "./support/test-project-service";

import { GatewayConfigAssemblyAdapter } from "../adapters/gateway-config-assembly.adapter";
class AllowTestQueries extends PrismaQueryGuard {
  execute(context: PrismaQueryContext, next: PrismaQueryExecutor): Promise<unknown> {
    return next(context.args);
  }
}

const databaseUrl = process.env.DATABASE_URL;
const connection = databaseUrl
  ? PrismaConnectionService.create({ guard: new AllowTestQueries() }).connect(
      PrismaConfigService.create().resolve({ databaseUrl, log: ["error"] }),
    )
  : null;
const prisma = connection?.client as PrismaClient;

/** The destination reads the materialiser makes, answered from seeded rows. */
class SuiteProjectService extends TestProjectService {
  override async tryGetTraceDestination(
    projectId: string,
  ): ReturnType<ProjectService["tryGetTraceDestination"]> {
    return await prisma.project.findUnique({
      where: { id: projectId },
      select: { id: true, teamId: true, apiKey: true, archivedAt: true },
    });
  }

  override async listTraceDestinations(
    projectIds: string[],
  ): ReturnType<ProjectService["listTraceDestinations"]> {
    return await prisma.project.findMany({
      where: { id: { in: projectIds } },
      select: { id: true, teamId: true, apiKey: true, archivedAt: true },
    });
  }

  override async resolveTraceDestination(
    input: Parameters<ProjectService["resolveTraceDestination"]>[0],
  ): ReturnType<ProjectService["resolveTraceDestination"]> {
    const projectId = input.traceProjectId ?? input.projectScopeIds[0];
    if (!projectId) return { outcome: "no_destination" };
    const project = await this.tryGetTraceDestination(projectId);
    return project ? { outcome: "resolved", project } : { outcome: "unknown" };
  }
}

/** Stored provider keys arrive already decrypted in these fixtures. */
const credentials: GatewayModelProviderCredentialsPort = {
  readCustomKeys: (stored: unknown) => stored as Record<string, unknown>,
};

const suffix = nanoid(8);
const ORG_ID = `org-mat-${suffix}`;
const TEAM_ID = `team-mat-${suffix}`;
const PROJECT_ID = `proj-mat-${suffix}`;
const USER_ID = `usr-mat-${suffix}`;
const MP_ID = `mp-mat-${suffix}`;
const MP_CUSTOM_ID = `mp-mat-custom-${suffix}`;
const MP_OPENAI_BASE_ID = `mp-mat-openai-base-${suffix}`;
const MP_ANTHROPIC_BASE_ID = `mp-mat-anthropic-base-${suffix}`;
const MP_ANTHROPIC_PLAIN_ID = `mp-mat-anthropic-plain-${suffix}`;
const MP_ANTHROPIC_KEYLESS_ID = `mp-mat-anthropic-keyless-${suffix}`;
const MP_SAFETY_ID = `mp-mat-safety-${suffix}`;
// A dispatchable, org-scoped provider the routing policy deliberately leaves
// OUT of its modelProviderIds. Scope-reachable, so savable in a key's
// allowlist, but the policy must keep it out of the dispatch chain.
const MP_POLICY_OMITTED_ID = `mp-mat-omitted-${suffix}`;
const RP_ID = `rp-mat-${suffix}`;
const VK_NO_RP_ID = `vk-mat-norp-${suffix}`;
const VK_POLICY_ALLOWLIST_ID = `vk-mat-policy-allow-${suffix}`;

const MODEL_PROVIDER_IDS = [
  MP_ID,
  MP_CUSTOM_ID,
  MP_OPENAI_BASE_ID,
  MP_ANTHROPIC_BASE_ID,
  MP_ANTHROPIC_PLAIN_ID,
  MP_ANTHROPIC_KEYLESS_ID,
  MP_SAFETY_ID,
  MP_POLICY_OMITTED_ID,
];

let gateway: GatewayService;

const materialiser = () =>
  GatewayConfigMaterialiserService.create({
    prisma,
    projects: new SuiteProjectService(),
    chRepo: null,
    budgetDecisions: gateway,
    credentials,
    assembly: GatewayConfigAssemblyAdapter.create({ prisma }),
  });

async function bundleFor(keyId: string) {
  const vk = await PrismaGatewayVirtualKeyRepository.create(prisma).tryFindById({
    id: keyId,
    organizationId: ORG_ID,
  });
  return await materialiser().materialise(vk!);
}

async function createProvider({
  id,
  name,
  provider,
  customKeys,
}: {
  id: string;
  name: string;
  provider: string;
  customKeys: Record<string, string>;
}) {
  await prisma.modelProvider.create({
    data: {
      id,
      name,
      provider,
      enabled: true,
      organizationId: ORG_ID,
      customKeys,
      scopes: { create: [{ scopeType: "ORGANIZATION", scopeId: ORG_ID }] },
    },
  });
}

describe.skipIf(!databaseUrl)("gateway bundle provider access (real PG)", () => {
  beforeAll(async () => {
    gateway = PrismaGatewayAdapter.create({
      database: prisma,
      projects: new SuiteProjectService(),
      evaluators: {} as never,
      monitors: {} as never,
      changes: {} as never,
      audit: {} as never,
    }).build();

    await prisma.organization.create({
      data: { id: ORG_ID, name: `Mat Org ${suffix}`, slug: `mat-${suffix}` },
    });
    await prisma.team.create({
      data: {
        id: TEAM_ID,
        name: `Mat Team ${suffix}`,
        slug: `mat-team-${suffix}`,
        organizationId: ORG_ID,
      },
    });
    await prisma.project.create({
      data: {
        id: PROJECT_ID,
        name: `Mat Project ${suffix}`,
        slug: `mat-proj-${suffix}`,
        teamId: TEAM_ID,
        language: "en",
        framework: "openai",
        apiKey: `key-${suffix}`,
      },
    });
    await prisma.user.create({
      data: { id: USER_ID, email: `${suffix}@mat.local`, name: "Mat" },
    });

    await createProvider({ id: MP_ID, name: "openai", provider: "openai", customKeys: {} });
    // Custom (OpenAI-compatible) provider: base URL required, API key
    // legitimately empty (unauthenticated self-hosted vLLM/LiteLLM).
    await createProvider({
      id: MP_CUSTOM_ID,
      name: "custom",
      provider: "custom",
      customKeys: { CUSTOM_API_KEY: "", CUSTOM_BASE_URL: "http://llm-server:8000/v1" },
    });
    await createProvider({
      id: MP_OPENAI_BASE_ID,
      name: "openai-proxy",
      provider: "openai",
      customKeys: {
        OPENAI_API_KEY: "sk-proxy-test",
        OPENAI_BASE_URL: "https://proxy.example.com/v1",
      },
    });
    await createProvider({
      id: MP_ANTHROPIC_BASE_ID,
      name: "anthropic-selfhosted",
      provider: "anthropic",
      customKeys: {
        ANTHROPIC_API_KEY: "sk-ant-selfhosted",
        ANTHROPIC_BASE_URL: "http://vllm-anthropic:8000",
      },
    });
    await createProvider({
      id: MP_ANTHROPIC_PLAIN_ID,
      name: "anthropic-plain",
      provider: "anthropic",
      customKeys: { ANTHROPIC_API_KEY: "sk-ant-plain" },
    });
    await createProvider({
      id: MP_ANTHROPIC_KEYLESS_ID,
      name: "anthropic-keyless",
      provider: "anthropic",
      customKeys: { ANTHROPIC_BASE_URL: "http://vllm-anthropic:8000" },
    });
    // Safety-type provider (azure_safety): holds evaluator credentials,
    // not chat-dispatchable — must never appear in a bundle's providers[],
    // because the Go router has no adapter for it.
    await createProvider({
      id: MP_SAFETY_ID,
      name: "azure-safety",
      provider: "azure_safety",
      customKeys: {
        AZURE_CONTENT_SAFETY_ENDPOINT: "https://safety.example.com",
        AZURE_CONTENT_SAFETY_KEY: "safety-key",
      },
    });
    // Dispatchable and scope-reachable, but intentionally NOT in the routing
    // policy below. A key can still allowlist it; the policy keeps it out.
    await createProvider({
      id: MP_POLICY_OMITTED_ID,
      name: "openai-omitted",
      provider: "openai",
      customKeys: { OPENAI_API_KEY: "sk-omitted-test" },
    });

    await prisma.routingPolicy.create({
      data: {
        id: RP_ID,
        organizationId: ORG_ID,
        scopes: { create: [{ scopeType: "ORGANIZATION", scopeId: ORG_ID }] },
        name: `mat-rp-${suffix}`,
        modelProviderIds: [
          MP_ID,
          MP_CUSTOM_ID,
          MP_OPENAI_BASE_ID,
          MP_ANTHROPIC_BASE_ID,
          MP_ANTHROPIC_PLAIN_ID,
          MP_ANTHROPIC_KEYLESS_ID,
        ],
        modelAliases: { "gpt-5": "gpt-5-mini" },
        policyRules: {
          tools: { deny: ["^shell_.*$"], allow: null },
          mcp: { deny: [], allow: null },
          urls: { deny: [], allow: null },
          models: { deny: [], allow: null },
        },
        isDefault: true,
      },
    });

    // No routing policy and no allowlist: every scope-reachable dispatchable
    // provider is in the chain.
    await prisma.virtualKey.create({
      data: {
        id: VK_NO_RP_ID,
        organizationId: ORG_ID,
        name: "vk-bare",
        hashedSecret: `hash-bare-${suffix}`,
        displayPrefix: "lw_vk_live_xxx_2",
        principalUserId: USER_ID,
        createdById: USER_ID,
        traceProjectId: PROJECT_ID,
        config: {},
        scopes: { create: [{ scopeType: "PROJECT", scopeId: PROJECT_ID }] },
      },
    });
    // On the routing policy, with an allowlist that names the policy-omitted
    // provider. Dispatch must still exclude it.
    await prisma.virtualKey.create({
      data: {
        id: VK_POLICY_ALLOWLIST_ID,
        organizationId: ORG_ID,
        name: "vk-policy-allowlist",
        hashedSecret: `hash-policy-allow-${suffix}`,
        displayPrefix: "lw_vk_live_xxx_5",
        principalUserId: USER_ID,
        createdById: USER_ID,
        traceProjectId: PROJECT_ID,
        routingPolicyId: RP_ID,
        config: { providersAllowed: [MP_ID, MP_POLICY_OMITTED_ID] },
        scopes: { create: [{ scopeType: "PROJECT", scopeId: PROJECT_ID }] },
      },
    });
  }, 60_000);

  afterAll(async () => {
    await prisma.virtualKey.deleteMany({
      where: { id: { in: [VK_NO_RP_ID, VK_POLICY_ALLOWLIST_ID] } },
    });
    await prisma.routingPolicyScope.deleteMany({ where: { routingPolicyId: RP_ID } });
    await prisma.routingPolicy.deleteMany({ where: { id: RP_ID } });
    await prisma.modelProviderScope.deleteMany({
      where: { modelProviderId: { in: MODEL_PROVIDER_IDS } },
    });
    await prisma.modelProvider.deleteMany({ where: { id: { in: MODEL_PROVIDER_IDS } } });
    await prisma.gatewayChangeEvent.deleteMany({ where: { organizationId: ORG_ID } });
    await prisma.user.deleteMany({ where: { id: USER_ID } });
    await prisma.project.deleteMany({ where: { id: PROJECT_ID } });
    await prisma.team.deleteMany({ where: { id: TEAM_ID } });
    await prisma.organization.deleteMany({ where: { id: ORG_ID } });
    await connection?.closeOnce();
  }, 60_000);

  describe("when materialising a VK with no linked routing policy", () => {
    /** @scenario "Safety-type providers are excluded from gateway dispatch chains" */
    it("excludes safety-type providers from the dispatch chain", async () => {
      const bundle = await bundleFor(VK_NO_RP_ID);

      // Naming the LLM provider that must survive, rather than just asserting
      // a non-empty list, keeps this from passing vacuously if the filter ever
      // drops dispatchable providers too.
      expect(bundle.providers.map((provider) => provider.id)).toContain(MP_ID);
      expect(bundle.providers.map((provider) => provider.id)).not.toContain(MP_SAFETY_ID);
      expect(bundle.fallback.chain).toContain(MP_ID);
      expect(bundle.fallback.chain).not.toContain(MP_SAFETY_ID);
    });
  });

  describe("when a VK on a routing policy allowlists a provider the policy omits", () => {
    /** @scenario "The routing policy still narrows the dispatch chain when the allowlist names an omitted provider" */
    it("excludes the policy-omitted provider from dispatch even though the allowlist names it", async () => {
      const bundle = await bundleFor(VK_POLICY_ALLOWLIST_ID);

      const dispatchIds = bundle.providers.map((provider) => provider.id);
      // The allowlist named MP_ID and the policy-omitted provider; only MP_ID
      // survives, because the routing policy keeps the omitted provider out of
      // dispatch regardless of the allowlist. The allowlist narrows within the
      // policy's set, it cannot widen past it.
      expect(dispatchIds).toContain(MP_ID);
      expect(dispatchIds).not.toContain(MP_POLICY_OMITTED_ID);
      expect(bundle.fallback.chain).not.toContain(MP_POLICY_OMITTED_ID);
    });

    /** @scenario "The bundle names why each undispatchable provider was dropped" */
    it("names why each undispatchable provider was dropped, so the gateway can say the reason", async () => {
      const bundle = await bundleFor(VK_POLICY_ALLOWLIST_ID);

      // Routing dropped the policy-omitted provider: scope-reachable and
      // allowed, but not in the policy's own list.
      expect(bundle.routing_excluded_providers).toEqual([
        { id: MP_POLICY_OMITTED_ID, type: "openai" },
      ]);
      // Provider access dropped every scope-reachable dispatchable provider
      // the allowlist leaves out. The non-dispatchable safety provider is not
      // scope-reachable for dispatch, so it is in neither list.
      expect(new Set(bundle.access_excluded_providers.map((provider) => provider.id))).toEqual(
        new Set([
          MP_CUSTOM_ID,
          MP_OPENAI_BASE_ID,
          MP_ANTHROPIC_BASE_ID,
          MP_ANTHROPIC_PLAIN_ID,
          MP_ANTHROPIC_KEYLESS_ID,
        ]),
      );
      expect(bundle.access_excluded_providers.map((provider) => provider.id)).not.toContain(
        MP_SAFETY_ID,
      );
      expect(bundle.routing_policy_name).toBe(`mat-rp-${suffix}`);
    });
  });
});
