/**
 * @vitest-environment node
 *
 * End-to-end integration coverage for GatewayConfigMaterialiser.
 *
 * Hits real PG via testcontainers — NO MOCKS. Validates that the
 * VK -> bundle wire shape stays in sync with the schema. This is the
 * class-of-bug check that catches the failure mode that bit (vd):
 * `include: { routingPolicy: ... }` typechecks clean against a
 * manually-widened result type but blows up at runtime when the
 * inverse relation is missing from schema.prisma.
 *
 * Coverage:
 *   1. Full bundle materialise — VK -> RP -> ModelProvider -> guardrails
 *      walk lands without runtime errors, every include resolves.
 *   2. RP-side hydration — modelAliases + policyRules normalize from
 *      the linked RoutingPolicy onto the bundle.
 *   3. Guardrails-side hydration — flat per-project catalog + VK
 *      attachment tuples ship under bundle.guardrails + .guardrail_attachments.
 *   4. Dangling guardrail id filter — vk.config.guardrailAttachments
 *      referencing a guardrail id NOT in the VK's project gets stripped
 *      before shipping (defense-in-depth at READ time).
 *   5. Empty-state — VK without a RP returns empty aliases + normalized
 *      empty policy rules; VK without a trace project returns empty
 *      guardrails + attachments.
 *
 * Spec: specs/ai-gateway/governance/guardrails-project-scope.feature
 *       specs/ai-gateway/governance/routing-policy-scope-cascade.feature
 *       specs/ai-gateway/governance/routing-policy-aliases-and-rules.feature
 */
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { EvaluatorService } from "@langwatch/evaluator-contract";

import { prisma } from "~/server/db";
import { createTestApp } from "~/server/app-layer/presets";
import {
  startTestContainers,
  stopTestContainers,
} from "~/server/event-sourcing/__tests__/integration/testContainers";
import { GatewayConfigMaterialiser } from "../config.materialiser";
import { GatewayGuardrailService } from "../guardrail.service";
import { VK_TAG_MAX_LENGTH, VK_TAGS_MAX_COUNT } from "@langwatch/gateway-contract";
import { VirtualKeyRepository } from "@langwatch/gateway-server";

const suffix = nanoid(8);
const projects = createTestApp().projects;
const ORG_ID = `org-mat-${suffix}`;
const TEAM_ID = `team-mat-${suffix}`;
const PROJECT_ID = `proj-mat-${suffix}`;
const USER_ID = `usr-mat-${suffix}`;
const EVALUATOR_ID = `eval-mat-${suffix}`;
const EVALUATOR_NOT_GUARDRAIL_ID = `eval-mat-nongr-${suffix}`;
const MONITOR_ID = `mon-mat-${suffix}`;
const MONITOR_NOT_GUARDRAIL_ID = `mon-mat-nongr-${suffix}`;
const MP_ID = `mp-mat-${suffix}`;
const MP_CUSTOM_ID = `mp-mat-custom-${suffix}`;
const CUSTOM_BASE_URL = "http://llm-server:8000/v1";
const MP_OPENAI_BASE_ID = `mp-mat-openai-base-${suffix}`;
const OPENAI_BASE_URL_OVERRIDE = "https://proxy.example.com/v1";
const MP_ANTHROPIC_BASE_ID = `mp-mat-anthropic-base-${suffix}`;
const ANTHROPIC_BASE_URL_OVERRIDE = "http://vllm-anthropic:8000";
const MP_ANTHROPIC_PLAIN_ID = `mp-mat-anthropic-plain-${suffix}`;
const MP_ANTHROPIC_KEYLESS_ID = `mp-mat-anthropic-keyless-${suffix}`;
const MP_SAFETY_ID = `mp-mat-safety-${suffix}`;
const RP_ID = `rp-mat-${suffix}`;
// A dispatchable, org-scoped provider the routing policy deliberately leaves
// OUT of its modelProviderIds. Scope-reachable, so savable in a key's
// allowlist, but the policy must keep it out of the dispatch chain.
const MP_POLICY_OMITTED_ID = `mp-mat-omitted-${suffix}`;
const GUARDRAIL_ID = `gr-mat-${suffix}`;
const VK_ID = `vk-mat-${suffix}`;
const VK_NO_RP_ID = `vk-mat-norp-${suffix}`;
const VK_NO_PROJECT_ID = `vk-mat-noproj-${suffix}`;
const VK_TAGSTORM_ID = `vk-mat-tagstorm-${suffix}`;
// A VK on the routing policy whose allowlist names the policy-omitted
// provider. Dispatch must still exclude it.
const VK_POLICY_ALLOWLIST_ID = `vk-mat-policy-allow-${suffix}`;
const evaluatorService = {
  tryGetById: async ({ id, projectId }: { id: string; projectId: string }) =>
    prisma.evaluator.findFirst({
      where: { id, projectId, archivedAt: null },
    }),
} as unknown as EvaluatorService;

describe("GatewayConfigMaterialiser — real PG end-to-end", () => {
  beforeAll(async () => {
    await startTestContainers();

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
    await prisma.evaluator.create({
      data: {
        id: EVALUATOR_ID,
        projectId: PROJECT_ID,
        name: `Mat evaluator ${suffix}`,
        slug: `mat-eval-${suffix}`,
        type: "evaluator",
        config: {},
      },
    });
    await prisma.evaluator.create({
      data: {
        id: EVALUATOR_NOT_GUARDRAIL_ID,
        projectId: PROJECT_ID,
        name: `Mat evaluator non-guardrail ${suffix}`,
        slug: `mat-eval-nongr-${suffix}`,
        type: "evaluator",
        config: {},
      },
    });
    // AS_GUARDRAIL monitor binds the first evaluator as guardrail-eligible.
    await prisma.monitor.create({
      data: {
        id: MONITOR_ID,
        projectId: PROJECT_ID,
        evaluatorId: EVALUATOR_ID,
        checkType: "evaluator",
        name: `Mat monitor ${suffix}`,
        slug: `mat-mon-${suffix}`,
        executionMode: "AS_GUARDRAIL",
        enabled: true,
        preconditions: [],
        parameters: {},
      },
    });
    // ON_MESSAGE monitor for the second evaluator — same project but
    // NOT a guardrail-eligible binding.
    await prisma.monitor.create({
      data: {
        id: MONITOR_NOT_GUARDRAIL_ID,
        projectId: PROJECT_ID,
        evaluatorId: EVALUATOR_NOT_GUARDRAIL_ID,
        checkType: "evaluator",
        name: `Mat monitor non-guardrail ${suffix}`,
        slug: `mat-mon-nongr-${suffix}`,
        executionMode: "ON_MESSAGE",
        enabled: true,
        preconditions: [],
        parameters: {},
      },
    });
    await prisma.modelProvider.create({
      data: {
        id: MP_ID,
        name: "openai",
        provider: "openai",
        enabled: true,
        organizationId: ORG_ID,
        customKeys: {},
        scopes: {
          create: [{ scopeType: "ORGANIZATION", scopeId: ORG_ID }],
        },
      },
    });
    // Custom (OpenAI-compatible) provider: base URL required, API key
    // legitimately empty (unauthenticated self-hosted vLLM/LiteLLM).
    await prisma.modelProvider.create({
      data: {
        id: MP_CUSTOM_ID,
        name: "custom",
        provider: "custom",
        enabled: true,
        organizationId: ORG_ID,
        customKeys: {
          CUSTOM_API_KEY: "",
          CUSTOM_BASE_URL,
        },
        scopes: {
          create: [{ scopeType: "ORGANIZATION", scopeId: ORG_ID }],
        },
      },
    });
    // OpenAI provider pointed at a self-hosted proxy via OPENAI_BASE_URL.
    // The materialiser must surface it as the slot base_url (from the
    // registry endpointKey), otherwise gateway traffic hits api.openai.com.
    await prisma.modelProvider.create({
      data: {
        id: MP_OPENAI_BASE_ID,
        name: "openai-proxy",
        provider: "openai",
        enabled: true,
        organizationId: ORG_ID,
        customKeys: {
          OPENAI_API_KEY: "sk-proxy-test",
          OPENAI_BASE_URL: OPENAI_BASE_URL_OVERRIDE,
        },
        scopes: {
          create: [{ scopeType: "ORGANIZATION", scopeId: ORG_ID }],
        },
      },
    });
    // Anthropic provider pointed at a self-hosted Anthropic-compatible
    // server (vLLM >= 0.24) via ANTHROPIC_BASE_URL. The materialiser must
    // surface it as the slot base_url, otherwise /v1/messages traffic
    // hits api.anthropic.com instead of the customer's endpoint.
    await prisma.modelProvider.create({
      data: {
        id: MP_ANTHROPIC_BASE_ID,
        name: "anthropic-selfhosted",
        provider: "anthropic",
        enabled: true,
        organizationId: ORG_ID,
        customKeys: {
          ANTHROPIC_API_KEY: "sk-ant-selfhosted",
          ANTHROPIC_BASE_URL: ANTHROPIC_BASE_URL_OVERRIDE,
        },
        scopes: {
          create: [{ scopeType: "ORGANIZATION", scopeId: ORG_ID }],
        },
      },
    });
    // Anthropic provider with only an API key: no base_url may leak into
    // the slot, or the gateway would derive a per-endpoint custom provider
    // for plain api.anthropic.com traffic.
    await prisma.modelProvider.create({
      data: {
        id: MP_ANTHROPIC_PLAIN_ID,
        name: "anthropic-plain",
        provider: "anthropic",
        enabled: true,
        organizationId: ORG_ID,
        customKeys: {
          ANTHROPIC_API_KEY: "sk-ant-plain",
        },
        scopes: {
          create: [{ scopeType: "ORGANIZATION", scopeId: ORG_ID }],
        },
      },
    });
    // Anthropic provider with a base URL and NO API key — the exact shape
    // #5938 exists to support (unauthenticated self-hosted server), and
    // the shape keysSchema used to reject. Anchors the keyless credential
    // through the real Prisma -> materialiser pipeline.
    await prisma.modelProvider.create({
      data: {
        id: MP_ANTHROPIC_KEYLESS_ID,
        name: "anthropic-keyless",
        provider: "anthropic",
        enabled: true,
        organizationId: ORG_ID,
        customKeys: {
          ANTHROPIC_BASE_URL: ANTHROPIC_BASE_URL_OVERRIDE,
        },
        scopes: {
          create: [{ scopeType: "ORGANIZATION", scopeId: ORG_ID }],
        },
      },
    });
    // Safety-type provider (azure_safety): holds evaluator credentials,
    // not chat-dispatchable — must never appear in a gateway bundle's
    // providers[] (the Go router has no Bifrost adapter for it).
    await prisma.modelProvider.create({
      data: {
        id: MP_SAFETY_ID,
        name: "azure-safety",
        provider: "azure_safety",
        enabled: true,
        organizationId: ORG_ID,
        customKeys: {
          AZURE_CONTENT_SAFETY_ENDPOINT: "https://safety.example.com",
          AZURE_CONTENT_SAFETY_KEY: "safety-key",
        },
        scopes: {
          create: [{ scopeType: "ORGANIZATION", scopeId: ORG_ID }],
        },
      },
    });
    // Dispatchable + scope-reachable, but intentionally NOT in the routing
    // policy below. A key can still allowlist it; the policy keeps it out of
    // dispatch.
    await prisma.modelProvider.create({
      data: {
        id: MP_POLICY_OMITTED_ID,
        name: "openai-omitted",
        provider: "openai",
        enabled: true,
        organizationId: ORG_ID,
        customKeys: { OPENAI_API_KEY: "sk-omitted-test" },
        scopes: {
          create: [{ scopeType: "ORGANIZATION", scopeId: ORG_ID }],
        },
      },
    });
    await prisma.routingPolicy.create({
      data: {
        id: RP_ID,
        organizationId: ORG_ID,
        scopes: {
          create: [{ scopeType: "ORGANIZATION", scopeId: ORG_ID }],
        },
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
    await prisma.gatewayGuardrail.create({
      data: {
        id: GUARDRAIL_ID,
        projectId: PROJECT_ID,
        name: `mat-guardrail-${suffix}`,
        evaluatorId: EVALUATOR_ID,
        direction: "PRE",
        failureMode: "FAIL_CLOSED",
        createdById: USER_ID,
        updatedById: USER_ID,
      },
    });
    // VK 1 — full happy path: project-scoped, linked to RP, attached
    // to the project guardrail. Also includes a dangling guardrail id
    // to exercise the dangling-id filter.
    await prisma.virtualKey.create({
      data: {
        id: VK_ID,
        organizationId: ORG_ID,
        name: "vk-with-everything",
        hashedSecret: `hash-everything-${suffix}`,
        displayPrefix: "lw_vk_live_xxx_1",
        principalUserId: USER_ID,
        createdById: USER_ID,
        // The destination is stored on the key rather than taken from its
        // scope, so a row written straight to PG has to carry it.
        traceProjectId: PROJECT_ID,
        routingPolicyId: RP_ID,
        config: {
          guardrailAttachments: [
            {
              direction: "pre",
              guardrailIds: [GUARDRAIL_ID, "not-a-real-guardrail-id"],
            },
          ],
          metadata: { tags: ["app=nexttrace", "team=offsecops"] },
        },
        scopes: {
          create: [{ scopeType: "PROJECT", scopeId: PROJECT_ID }],
        },
      },
    });
    // VK 4 — a config row written straight to PG with a tag list no UI
    // would produce: hundreds of tags, one enormous tag, duplicates and
    // blanks. Rows like this predate the tag bounds and the REST API can
    // still post one, so materialise has to hand the gateway something
    // bounded regardless.
    await prisma.virtualKey.create({
      data: {
        id: VK_TAGSTORM_ID,
        organizationId: ORG_ID,
        name: "vk-tagstorm",
        hashedSecret: `hash-tagstorm-${suffix}`,
        displayPrefix: "lw_vk_live_xxx_4",
        principalUserId: USER_ID,
        createdById: USER_ID,
        traceProjectId: PROJECT_ID,
        config: {
          metadata: {
            tags: [
              "team=ml",
              " team=ml ",
              "",
              "x".repeat(5_000),
              ...Array.from({ length: 500 }, (_, i) => `noise-${i}`),
            ],
          },
        },
        scopes: {
          create: [{ scopeType: "PROJECT", scopeId: PROJECT_ID }],
        },
      },
    });
    // VK 2 — no RP, no attachments. Exercises the empty-state path.
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
        scopes: {
          create: [{ scopeType: "PROJECT", scopeId: PROJECT_ID }],
        },
      },
    });
    // VK 3 — org-scoped with no destination, the shape a key written before
    // the destination was stored can still be in. Exercises the
    // guardrails:[] empty-state branch when the pointer is null.
    await prisma.virtualKey.create({
      data: {
        id: VK_NO_PROJECT_ID,
        organizationId: ORG_ID,
        name: "vk-org",
        hashedSecret: `hash-org-${suffix}`,
        displayPrefix: "lw_vk_live_xxx_3",
        principalUserId: USER_ID,
        createdById: USER_ID,
        routingPolicyId: RP_ID,
        config: {},
        scopes: {
          create: [{ scopeType: "ORGANIZATION", scopeId: ORG_ID }],
        },
      },
    });
    // VK 5 — on the routing policy, project-scoped, with an allowlist that
    // names the policy-omitted provider. Dispatch must still exclude it: the
    // policy narrows the chain even though the allowlist would keep it.
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
        scopes: {
          create: [{ scopeType: "PROJECT", scopeId: PROJECT_ID }],
        },
      },
    });
  }, 60_000);

  afterAll(async () => {
    await prisma.virtualKey.deleteMany({
      where: {
        id: {
          in: [
            VK_ID,
            VK_NO_RP_ID,
            VK_NO_PROJECT_ID,
            VK_TAGSTORM_ID,
            VK_POLICY_ALLOWLIST_ID,
          ],
        },
      },
    });
    await prisma.gatewayGuardrail.deleteMany({
      where: { projectId: PROJECT_ID },
    });
    await prisma.monitor.deleteMany({
      where: {
        projectId: PROJECT_ID,
        id: { in: [MONITOR_ID, MONITOR_NOT_GUARDRAIL_ID] },
      },
    });
    await prisma.routingPolicyScope.deleteMany({
      where: { routingPolicyId: RP_ID },
    });
    await prisma.routingPolicy.deleteMany({ where: { id: RP_ID } });
    const modelProviderIds = [
      MP_ID,
      MP_CUSTOM_ID,
      MP_OPENAI_BASE_ID,
      MP_ANTHROPIC_BASE_ID,
      MP_ANTHROPIC_PLAIN_ID,
      MP_ANTHROPIC_KEYLESS_ID,
      MP_SAFETY_ID,
      MP_POLICY_OMITTED_ID,
    ];
    await prisma.modelProviderScope.deleteMany({
      where: {
        modelProviderId: { in: modelProviderIds },
      },
    });
    await prisma.modelProvider.deleteMany({
      where: { id: { in: modelProviderIds } },
    });
    await prisma.evaluator.deleteMany({
      where: { id: { in: [EVALUATOR_ID, EVALUATOR_NOT_GUARDRAIL_ID] } },
    });
    await prisma.user.deleteMany({ where: { id: USER_ID } });
    await prisma.project.deleteMany({ where: { id: PROJECT_ID } });
    await prisma.team.deleteMany({ where: { id: TEAM_ID } });
    await prisma.organization.deleteMany({ where: { id: ORG_ID } });
    await stopTestContainers();
  }, 60_000);

  describe("when materialising a project-scoped VK with linked RP + attached guardrail", () => {
    it("hydrates routingPolicy via the include without runtime error", async () => {
      // This is the regression-target for the inverse-relation drift
      // fixed at 8b5d6fe4e. If the VK <-> RP relation drops, the
      // include throws "Unknown nested field routingPolicy" before
      // we even reach the assertions.
      const repo = new VirtualKeyRepository(prisma);
      const vk = await repo.findById(VK_ID, ORG_ID);
      expect(vk).not.toBeNull();
      expect(vk!.routingPolicy).not.toBeNull();
      expect(vk!.routingPolicy?.id).toBe(RP_ID);
    });

    it("materialises the bundle without runtime error", async () => {
      const repo = new VirtualKeyRepository(prisma);
      const vk = await repo.findById(VK_ID, ORG_ID);
      const mat = new GatewayConfigMaterialiser(prisma, projects, null);
      const bundle = await mat.materialise(vk!);
      expect(bundle.vk_id).toBe(VK_ID);
      expect(bundle.status).toBe("active");
      expect(bundle.organization_id).toBe(ORG_ID);
      expect(bundle.project_id).toBe(PROJECT_ID);
      expect(bundle.providers.length).toBeGreaterThan(0);
    });

    it("materialises the custom provider slot with its base_url and empty api_key", async () => {
      const repo = new VirtualKeyRepository(prisma);
      const vk = await repo.findById(VK_ID, ORG_ID);
      const mat = new GatewayConfigMaterialiser(prisma, projects, null);
      const bundle = await mat.materialise(vk!);
      const slot = bundle.providers.find((p) => p.id === MP_CUSTOM_ID);
      expect(slot).toBeDefined();
      expect(slot!.type).toBe("custom");
      expect(slot!.base_url).toBe(CUSTOM_BASE_URL);
      expect(slot!.credentials.api_key).toBe("");
    });

    it("materialises an openai provider slot with OPENAI_BASE_URL as its base_url", async () => {
      const repo = new VirtualKeyRepository(prisma);
      const vk = await repo.findById(VK_ID, ORG_ID);
      const mat = new GatewayConfigMaterialiser(prisma, projects, null);
      const bundle = await mat.materialise(vk!);
      const slot = bundle.providers.find((p) => p.id === MP_OPENAI_BASE_ID);
      expect(slot).toBeDefined();
      expect(slot!.type).toBe("openai");
      expect(slot!.base_url).toBe(OPENAI_BASE_URL_OVERRIDE);
    });

    // Spec: specs/ai-gateway/custom-provider-base-url.feature
    // "Anthropic provider with a base URL routes /v1/messages to the
    // customer's endpoint" — the gateway reads the slot base_url, so the
    // materialiser must emit ANTHROPIC_BASE_URL there.
    it("materialises an anthropic provider slot with ANTHROPIC_BASE_URL as its base_url", async () => {
      const repo = new VirtualKeyRepository(prisma);
      const vk = await repo.findById(VK_ID, ORG_ID);
      const mat = new GatewayConfigMaterialiser(prisma, projects, null);
      const bundle = await mat.materialise(vk!);
      const slot = bundle.providers.find((p) => p.id === MP_ANTHROPIC_BASE_ID);
      expect(slot).toBeDefined();
      expect(slot!.type).toBe("anthropic");
      expect(slot!.base_url).toBe(ANTHROPIC_BASE_URL_OVERRIDE);
      expect(slot!.credentials.api_key).toBe("sk-ant-selfhosted");
    });

    // Spec: specs/ai-gateway/custom-provider-base-url.feature
    // "Empty API key is accepted for unauthenticated Anthropic-compatible
    // servers" — the keyless credential must survive the real
    // Prisma -> materialiser pipeline with an empty api_key and the
    // configured base_url, mirroring the Go-side keyless dispatch test at
    // the layer where the original #5938 rejection manifested.
    it("materialises a keyless anthropic provider slot with its base_url and empty api_key", async () => {
      const repo = new VirtualKeyRepository(prisma);
      const vk = await repo.findById(VK_ID, ORG_ID);
      const mat = new GatewayConfigMaterialiser(prisma, projects, null);
      const bundle = await mat.materialise(vk!);
      const slot = bundle.providers.find((p) => p.id === MP_ANTHROPIC_KEYLESS_ID);
      expect(slot).toBeDefined();
      expect(slot!.type).toBe("anthropic");
      expect(slot!.base_url).toBe(ANTHROPIC_BASE_URL_OVERRIDE);
      expect(slot!.credentials.api_key).toBe("");
    });

    // Spec: specs/ai-gateway/custom-provider-base-url.feature
    // "Anthropic provider without a base URL keeps default routing" — a
    // leaked base_url would make the gateway derive a per-endpoint custom
    // provider for plain api.anthropic.com traffic.
    it("materialises an anthropic provider slot without ANTHROPIC_BASE_URL with no base_url", async () => {
      const repo = new VirtualKeyRepository(prisma);
      const vk = await repo.findById(VK_ID, ORG_ID);
      const mat = new GatewayConfigMaterialiser(prisma, projects, null);
      const bundle = await mat.materialise(vk!);
      const slot = bundle.providers.find((p) => p.id === MP_ANTHROPIC_PLAIN_ID);
      expect(slot).toBeDefined();
      expect(slot!.type).toBe("anthropic");
      expect(slot!.base_url).toBeUndefined();
    });

    // Spec: specs/ai-gateway/span-shape.feature §8 — the gateway stamps
    // these tags on customer spans as langwatch.labels, and cache-rule
    // vk_tags matchers compare against them. Without a top-level vk_tags
    // in the bundle both consumers read a permanently-empty list.
    it("lifts config.metadata.tags to the bundle's top-level vk_tags", async () => {
      const repo = new VirtualKeyRepository(prisma);
      const vk = await repo.findById(VK_ID, ORG_ID);
      const mat = new GatewayConfigMaterialiser(prisma, projects, null);
      const bundle = await mat.materialise(vk!);
      expect(bundle.vk_tags).toEqual(["app=nexttrace", "team=offsecops"]);
    });

    // Every tag is stamped on every span this VK produces and aggregated by
    // the Label facet, so the bundle is the last place to bound them before
    // they become per-request ClickHouse cardinality.
    it("bounds vk_tags for a stored config the drawer could never have written", async () => {
      const repo = new VirtualKeyRepository(prisma);
      const vk = await repo.findById(VK_TAGSTORM_ID, ORG_ID);
      const mat = new GatewayConfigMaterialiser(prisma, projects, null);

      const bundle = await mat.materialise(vk!);

      expect(bundle.vk_tags).toHaveLength(VK_TAGS_MAX_COUNT);
      expect(bundle.vk_tags[0]).toBe("team=ml");
      expect(new Set(bundle.vk_tags).size).toBe(bundle.vk_tags.length);
      for (const tag of bundle.vk_tags) {
        expect(tag).not.toBe("");
        expect([...tag].length).toBeLessThanOrEqual(VK_TAG_MAX_LENGTH);
      }
    });

    it("hydrates model_aliases + policy_rules from the linked RoutingPolicy", async () => {
      const repo = new VirtualKeyRepository(prisma);
      const vk = await repo.findById(VK_ID, ORG_ID);
      const mat = new GatewayConfigMaterialiser(prisma, projects, null);
      const bundle = await mat.materialise(vk!);
      expect(bundle.model_aliases).toEqual({ "gpt-5": "gpt-5-mini" });
      expect(bundle.policy_rules).toEqual({
        tools: { deny: ["^shell_.*$"], allow: null },
        mcp: { deny: [], allow: null },
        urls: { deny: [], allow: null },
        models: { deny: [], allow: null },
      });
    });

    it("ships the project guardrail under bundle.guardrails", async () => {
      const repo = new VirtualKeyRepository(prisma);
      const vk = await repo.findById(VK_ID, ORG_ID);
      const mat = new GatewayConfigMaterialiser(prisma, projects, null);
      const bundle = await mat.materialise(vk!);
      expect(bundle.guardrails).toHaveLength(1);
      const row = bundle.guardrails[0]!;
      expect(row.id).toBe(GUARDRAIL_ID);
      expect(row.evaluator_id).toBe(EVALUATOR_ID);
      expect(row.direction).toBe("pre");
      expect(row.failure_mode).toBe("fail_closed");
    });

    it("filters dangling guardrail ids out of bundle.guardrail_attachments", async () => {
      const repo = new VirtualKeyRepository(prisma);
      const vk = await repo.findById(VK_ID, ORG_ID);
      const mat = new GatewayConfigMaterialiser(prisma, projects, null);
      const bundle = await mat.materialise(vk!);
      // The VK's config carries two ids: a real one and a dangling one.
      // The materialiser must strip the dangling id before shipping.
      expect(bundle.guardrail_attachments).toHaveLength(1);
      expect(bundle.guardrail_attachments[0]).toEqual({
        direction: "pre",
        guardrail_ids: [GUARDRAIL_ID],
      });
    });
  });

  describe("when materialising a VK with no linked RoutingPolicy", () => {
    /** @scenario Safety-type providers are excluded from gateway dispatch chains */
    it("excludes safety-type providers (azure_safety) from the dispatch chain", async () => {
      const repo = new VirtualKeyRepository(prisma);
      const vk = await repo.findById(VK_NO_RP_ID, ORG_ID);
      const mat = new GatewayConfigMaterialiser(prisma, projects, null);
      const bundle = await mat.materialise(vk!);
      // Naming the LLM provider that must survive, rather than just
      // asserting a non-empty list, keeps this from passing vacuously if
      // the filter ever drops dispatchable providers too.
      expect(bundle.providers.map((p) => p.id)).toContain(MP_ID);
      expect(bundle.providers.map((p) => p.id)).not.toContain(MP_SAFETY_ID);
      expect(bundle.fallback.chain).toContain(MP_ID);
      expect(bundle.fallback.chain).not.toContain(MP_SAFETY_ID);
    });

    it("returns empty model_aliases + normalized empty policy_rules", async () => {
      const repo = new VirtualKeyRepository(prisma);
      const vk = await repo.findById(VK_NO_RP_ID, ORG_ID);
      const mat = new GatewayConfigMaterialiser(prisma, projects, null);
      const bundle = await mat.materialise(vk!);
      expect(bundle.model_aliases).toEqual({});
      expect(bundle.policy_rules).toEqual({
        tools: { deny: [], allow: null },
        mcp: { deny: [], allow: null },
        urls: { deny: [], allow: null },
        models: { deny: [], allow: null },
      });
    });
  });

  describe("when GatewayGuardrailService.create gates on AS_GUARDRAIL monitor", () => {
    it("accepts an evaluator with at least one enabled AS_GUARDRAIL monitor in the project", async () => {
      const service = GatewayGuardrailService.create(prisma, evaluatorService);
      const row = await service.create({
        projectId: PROJECT_ID,
        name: `Accept guardrail ${suffix}`,
        description: null,
        evaluatorId: EVALUATOR_ID,
        direction: "POST",
        failureMode: "FAIL_CLOSED",
        actorUserId: USER_ID,
      });
      expect(row.id).toBeTruthy();
      expect(row.evaluatorId).toBe(EVALUATOR_ID);
      expect(row.direction).toBe("POST");
    });

    it("rejects an evaluator with no AS_GUARDRAIL monitor in the project", async () => {
      const service = GatewayGuardrailService.create(prisma, evaluatorService);
      await expect(
        service.create({
          projectId: PROJECT_ID,
          name: `Reject guardrail ${suffix}`,
          description: null,
          evaluatorId: EVALUATOR_NOT_GUARDRAIL_ID,
          direction: "PRE",
          actorUserId: USER_ID,
        }),
      ).rejects.toThrow(/evaluator_not_as_guardrail/);
    });
  });

  describe("when materialising an ORG-scoped VK with no trace project", () => {
    it("returns empty guardrails + empty attachments (no project context)", async () => {
      const repo = new VirtualKeyRepository(prisma);
      const vk = await repo.findById(VK_NO_PROJECT_ID, ORG_ID);
      const mat = new GatewayConfigMaterialiser(prisma, projects, null);
      const bundle = await mat.materialise(vk!);
      // No traceProject → no project to fetch guardrails from. Even
      // with a linked RP that contributes aliases, the guardrails
      // side stays empty.
      expect(bundle.guardrails).toEqual([]);
      expect(bundle.guardrail_attachments).toEqual([]);
      // RP still hydrates the policy side regardless of traceProject.
      expect(bundle.model_aliases).toEqual({ "gpt-5": "gpt-5-mini" });
    });
  });

  describe("when a VK on a routing policy allowlists a provider the policy omits", () => {
    /** @scenario The routing policy still narrows the dispatch chain when the allowlist names an omitted provider */
    it("excludes the policy-omitted provider from dispatch even though the allowlist names it", async () => {
      const repo = new VirtualKeyRepository(prisma);
      const vk = await repo.findById(VK_POLICY_ALLOWLIST_ID, ORG_ID);
      const mat = new GatewayConfigMaterialiser(prisma, projects, null);
      const bundle = await mat.materialise(vk!);

      const dispatchIds = bundle.providers.map((p) => p.id);
      // The allowlist named MP_ID and the policy-omitted provider; only MP_ID
      // survives, because the routing policy keeps the omitted provider out of
      // dispatch regardless of the allowlist. The allowlist narrows within the
      // policy's set, it cannot widen past it.
      expect(dispatchIds).toContain(MP_ID);
      expect(dispatchIds).not.toContain(MP_POLICY_OMITTED_ID);
      expect(bundle.fallback.chain).not.toContain(MP_POLICY_OMITTED_ID);
    });

    /** @scenario The bundle names why each undispatchable provider was dropped */
    it("names why each undispatchable provider was dropped, so the gateway can say the reason", async () => {
      const repo = new VirtualKeyRepository(prisma);
      const vk = await repo.findById(VK_POLICY_ALLOWLIST_ID, ORG_ID);
      const mat = new GatewayConfigMaterialiser(prisma, projects, null);
      const bundle = await mat.materialise(vk!);

      // Routing dropped the policy-omitted provider: scope-reachable and
      // allowed, but not in the policy's own list.
      expect(bundle.routing_excluded_providers).toEqual([
        { id: MP_POLICY_OMITTED_ID, type: "openai" },
      ]);
      // Provider access dropped every scope-reachable dispatchable provider
      // the allowlist leaves out. The non-dispatchable safety provider is not
      // scope-reachable for dispatch, so it is in neither list.
      expect(new Set(bundle.access_excluded_providers.map((p) => p.id))).toEqual(
        new Set([
          MP_CUSTOM_ID,
          MP_OPENAI_BASE_ID,
          MP_ANTHROPIC_BASE_ID,
          MP_ANTHROPIC_PLAIN_ID,
          MP_ANTHROPIC_KEYLESS_ID,
        ]),
      );
      expect(bundle.access_excluded_providers.map((p) => p.id)).not.toContain(
        MP_SAFETY_ID,
      );
      expect(bundle.routing_policy_name).toBe(`mat-rp-${suffix}`);
    });
  });

  describe("when a VK reaches every provider it is scoped to", () => {
    it("reports no provider exclusions and no routing policy name", async () => {
      const repo = new VirtualKeyRepository(prisma);
      const vk = await repo.findById(VK_NO_RP_ID, ORG_ID);
      const mat = new GatewayConfigMaterialiser(prisma, projects, null);
      const bundle = await mat.materialise(vk!);

      // No allowlist and no routing policy: nothing is dropped, so there is no
      // reason to name.
      expect(bundle.routing_excluded_providers).toEqual([]);
      expect(bundle.access_excluded_providers).toEqual([]);
      expect(bundle.routing_policy_name).toBeNull();
    });
  });
});
