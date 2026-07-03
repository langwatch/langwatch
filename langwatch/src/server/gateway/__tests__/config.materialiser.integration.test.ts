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

import { prisma } from "~/server/db";
import {
  startTestContainers,
  stopTestContainers,
} from "~/server/event-sourcing/__tests__/integration/testContainers";
import { GatewayConfigMaterialiser } from "../config.materialiser";
import { GatewayGuardrailService } from "../guardrail.service";
import { VirtualKeyRepository } from "../virtualKey.repository";

const suffix = nanoid(8);
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
const RP_ID = `rp-mat-${suffix}`;
const GUARDRAIL_ID = `gr-mat-${suffix}`;
const VK_ID = `vk-mat-${suffix}`;
const VK_NO_RP_ID = `vk-mat-norp-${suffix}`;
const VK_NO_PROJECT_ID = `vk-mat-noproj-${suffix}`;

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
    await prisma.routingPolicy.create({
      data: {
        id: RP_ID,
        organizationId: ORG_ID,
        scopes: {
          create: [{ scopeType: "ORGANIZATION", scopeId: ORG_ID }],
        },
        name: `mat-rp-${suffix}`,
        modelProviderIds: [MP_ID, MP_CUSTOM_ID],
        modelAliases: { "gpt-5": "gpt-5-mini" },
        policyRules: {
          tools: { deny: ["^shell_.*$"], allow: null },
          mcp: { deny: [], allow: null },
          urls: { deny: [], allow: null },
          models: { deny: [], allow: null },
        },
        strategy: "priority",
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
        routingPolicyId: RP_ID,
        config: {
          guardrailAttachments: [
            {
              direction: "pre",
              guardrailIds: [GUARDRAIL_ID, "not-a-real-guardrail-id"],
            },
          ],
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
        config: {},
        scopes: {
          create: [{ scopeType: "PROJECT", scopeId: PROJECT_ID }],
        },
      },
    });
    // VK 3 — org-scoped (no trace project). Exercises the guardrails:[]
    // empty-state branch when traceProject resolves to null.
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
  }, 60_000);

  afterAll(async () => {
    await prisma.virtualKey.deleteMany({
      where: { id: { in: [VK_ID, VK_NO_RP_ID, VK_NO_PROJECT_ID] } },
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
    await prisma.modelProviderScope.deleteMany({
      where: { modelProviderId: { in: [MP_ID, MP_CUSTOM_ID] } },
    });
    await prisma.modelProvider.deleteMany({
      where: { id: { in: [MP_ID, MP_CUSTOM_ID] } },
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
      const mat = new GatewayConfigMaterialiser(prisma, null);
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
      const mat = new GatewayConfigMaterialiser(prisma, null);
      const bundle = await mat.materialise(vk!);
      const slot = bundle.providers.find((p) => p.id === MP_CUSTOM_ID);
      expect(slot).toBeDefined();
      expect(slot!.type).toBe("custom");
      expect(slot!.base_url).toBe(CUSTOM_BASE_URL);
      expect(slot!.credentials.api_key).toBe("");
    });

    it("hydrates model_aliases + policy_rules from the linked RoutingPolicy", async () => {
      const repo = new VirtualKeyRepository(prisma);
      const vk = await repo.findById(VK_ID, ORG_ID);
      const mat = new GatewayConfigMaterialiser(prisma, null);
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
      const mat = new GatewayConfigMaterialiser(prisma, null);
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
      const mat = new GatewayConfigMaterialiser(prisma, null);
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
    it("returns empty model_aliases + normalized empty policy_rules", async () => {
      const repo = new VirtualKeyRepository(prisma);
      const vk = await repo.findById(VK_NO_RP_ID, ORG_ID);
      const mat = new GatewayConfigMaterialiser(prisma, null);
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
      const service = GatewayGuardrailService.create(prisma);
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
      const service = GatewayGuardrailService.create(prisma);
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
      const mat = new GatewayConfigMaterialiser(prisma, null);
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
});
