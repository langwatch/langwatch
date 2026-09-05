/**
 * Materialises the internal gateway config bundle. Since the virtual-key binding collapse the
 * model provider absorbed the old gateway credential's fields, and a key's eligible-provider set
 * computes from its scope graph plus the optional routing policy's ordering.
 */
import type { GatewayBudget, ModelProvider, VirtualKey } from "@langwatch/gateway-contract";

import { GatewayConfigAssemblyPort } from "../ports/gateway-config-assembly.port";
import type { GatewayModelProviderCredentialsPort } from "../ports/gateway-model-provider-credentials.port";
import { resolveLangyMirrorTier, type LangyMirrorTier } from "@langwatch/langy-contract";
import { modelProviders } from "@langwatch/model-provider-contract";
import { GatewayBudgetSpendPort } from "../ports/gateway-budget-spend.port";
import type { ProjectService } from "@langwatch/project-contract";
import {
  budgetPeriodFloorMs,
  effectiveBudgetPeriod,
  parseVirtualKeyConfig,
  type GatewayBudgetResource,
  type GatewayCacheRuleResource,
  type GatewayConfigGuardrailAttachment,
  type GatewayGuardrailBundleEntry,
  type GatewayMoney,
  type GatewayResolvedBudget,
  type GatewayService,
} from "@langwatch/gateway-contract";
import type { GatewayScopeResolutionService } from "./gateway-scope-resolution.service";
import { type VirtualKeyWithScopes } from "../ports/gateway-virtual-key.port";
import {
  budgetToWire,
  buildProviderSlot,
  cacheRuleToWire,
  expiresAtWire,
  guardrailAttachmentToWire,
  guardrailToWire,
  providerExclusions,
  providerExclusionWire,
  resolvePolicySideOfBundle,
  routingModeToWire,
  type GatewayConfigPayload,
  type ProviderExclusionWire,
} from "../rules/gateway-config-wire.rules";

export class GatewayConfigMaterialiserService {
  private constructor(
    /** Which providers a key reaches, and in which dispatch order. */
    private readonly scopeResolution: GatewayScopeResolutionService,
    private readonly projects: ProjectService,
    private readonly chRepo: GatewayBudgetSpendPort | null,
    /**
     * The process's own gateway service. Required rather than defaulted: building one here meant
     * composing a second service per request over the same tables, and the default could not be
     * completed once that service grew its guardrail and cache-rule collaborators.
     */
    private readonly budgetDecisions: GatewayService,
    /**
     * Reads a provider row's stored keys. A port because the cipher belongs to
     * the Model Provider feature and a gateway package may not depend on
     * another feature's server package.
     */
    private readonly credentials: GatewayModelProviderCredentialsPort,
    /**
     * The version token, the reserved tier vocabulary and the shipped model
     * catalog: the three reads the bundle needs that are not this service's
     * own logic.
     */
    private readonly assembly: GatewayConfigAssemblyPort,
    /**
     * The mirror project this deployment names, if any. Stated by the
     * composition root rather than read here: a package receives its
     * deployment facts as configuration.
     */
    private readonly langyMirrorProjectId: string | undefined,
  ) {}

  static create(input: {
    scopeResolution: GatewayScopeResolutionService;
    projects: ProjectService;
    chRepo: GatewayBudgetSpendPort | null;
    budgetDecisions: GatewayService;
    credentials: GatewayModelProviderCredentialsPort;
    assembly: GatewayConfigAssemblyPort;
    /** `LANGY_MIRROR_PROJECT_ID`; absent means nothing is mirrored. */
    langyMirrorProjectId?: string | undefined;
  }): GatewayConfigMaterialiserService {
    return new GatewayConfigMaterialiserService(
      input.scopeResolution,
      input.projects,
      input.chRepo,
      input.budgetDecisions,
      input.credentials,
      input.assembly,
      input.langyMirrorProjectId,
    );
  }

  /**
   * Providers this key dispatches to, plus the three wire fields naming why a resolved provider
   * was not used. The eligible set is already routing-policy-applied, so scope-reachable minus
   * dispatch is what the policy dropped and the allowlist complement is what access dropped.
   */
  private async dispatchAndExclusions(
    vk: VirtualKeyWithScopes,
    eligibleProviders: ModelProvider[],
    allowed: string[] | null,
  ): Promise<{
    providers: ModelProvider[];
    exclusions: {
      routing_excluded_providers: ProviderExclusionWire[];
      access_excluded_providers: ProviderExclusionWire[];
      routing_policy_name: string | null;
    };
  }> {
    const providers = allowed
      ? eligibleProviders.filter((mp) => allowed.includes(mp.id))
      : eligibleProviders;
    const scopeReachable = await this.scopeResolution.scopeReachableModelProvidersForVk(vk);
    const { routingExcluded, accessExcluded } = providerExclusions({
      scopeReachable,
      eligibleProviders,
      allowed,
    });

    return {
      providers,
      exclusions: {
        routing_excluded_providers: routingExcluded.map(providerExclusionWire),
        access_excluded_providers: accessExcluded.map(providerExclusionWire),
        routing_policy_name: vk.routingPolicy?.name ?? null,
      },
    };
  }

  /**
   * Version token for the bundle materialise would build for this key. It lives beside materialise
   * because it describes that output: the token must move whenever the bundle would differ, and
   * drifting apart is what lets a 304 confirm a stale bundle.
   */
  async versionToken(vk: VirtualKeyWithScopes): Promise<string> {
    return await this.assembly.versionToken(vk);
  }

  async materialise(vk: VirtualKeyWithScopes): Promise<GatewayConfigPayload> {
    const eligibleProviders = await this.scopeResolution.eligibleModelProvidersForVk(vk);
    const traceProject = vk.traceProjectId
      ? await this.projects.tryGetTraceDestination(vk.traceProjectId)
      : null;
    const budgets = await this.applicableBudgets(vk, traceProject);
    const spendByBudgetId = await this.loadCurrentSpend(vk, budgets);
    const config = parseVirtualKeyConfig(vk.config);
    const { providers, exclusions } = await this.dispatchAndExclusions(
      vk,
      eligibleProviders,
      config.providersAllowed,
    );
    const policySides = resolvePolicySideOfBundle(vk, config, this.assembly);
    // The cache-rule bundle, the project's guardrail catalogue and the key's
    // surviving attachments come from the one Gateway service that owns those
    // tables, rather than from a second copy of each query living here.
    const bundle = await this.budgetDecisions.loadConfigurationPersistence({
      organizationId: vk.organizationId,
      traceProjectId: traceProject?.id ?? null,
      guardrailAttachments: config.guardrailAttachments.map((attachment) => ({
        direction: attachment.direction,
        guardrailIds: [...attachment.guardrailIds],
      })),
    });

    return {
      revision: vk.revision.toString(),
      vk_id: vk.id,
      status: vk.status === "ACTIVE" ? "active" : "revoked",
      display_prefix: vk.displayPrefix,
      organization_id: vk.organizationId,
      project_id: traceProject?.id ?? null,
      project_otlp_token: traceProject?.apiKey ?? null,
      team_id: traceProject?.teamId ?? null,
      principal_id: vk.principalUserId,
      // ADR-061: only a Langy VK's calls are mirrored — the gen_ai span is the
      // one part of a Langy turn's trace the manager's relay never sees. Every
      // other VK resolves to skip, so ordinary customer traffic is never
      // duplicated into LangWatch's mirror project.
      langy_mirror_tier:
        vk.purpose === "LANGY" && traceProject?.id
          ? resolveLangyMirrorTier(
              { projectId: traceProject.id },
              { LANGY_MIRROR_PROJECT_ID: this.langyMirrorProjectId },
            )
          : "skip",
      providers: providers.map((mp, index) =>
        buildProviderSlot(mp, index, this.credentials, this.assembly),
      ),
      fallback: {
        chain: providers.map((mp) => mp.id),
        // routing_mode NONE means the request never leaves the provider
        // that serves the model, so the attempt budget is one. Pinning it
        // here makes no-fallback real for gateways that predate the
        // routing_mode field instead of promising it in the UI only.
        max_attempts: vk.routingMode === "NONE" ? 1 : config.fallback.maxAttempts,
      },
      model_aliases: policySides.modelAliases,
      models_allowed: config.modelsAllowed,
      providers_allowed: config.providersAllowed,
      routing_mode: routingModeToWire(vk.routingMode),
      ...exclusions,
      cache: { mode: config.cache.mode, ttl_s: config.cache.ttlS },
      guardrails: bundle.guardrails.map(guardrailToWire),
      guardrail_attachments: bundle.attachments.map(guardrailAttachmentToWire),
      policy_rules: policySides.policyRules,
      rate_limits: {
        rpm: config.rateLimits.rpm,
        tpm: config.rateLimits.tpm,
        rpd: config.rateLimits.rpd,
      },
      budgets: budgets.map((resolved) => budgetToWire(resolved, spendByBudgetId)),
      cache_rules: bundle.cacheRules.map(cacheRuleToWire),
      metadata: config.metadata ?? {},
      vk_tags: config.metadata?.tags ?? [],
      expires_at: expiresAtWire(vk.expiresAt),
    };
  }

  /**
   * ClickHouse spend rollup, best-effort: it falls back to the Postgres column when ClickHouse is
   * not wired. The tenant set is every project under the key's org, so org, team and principal
   * budgets see ledger rows under whichever project emitted the trace.
   */
  private async loadCurrentSpend(
    vk: VirtualKeyWithScopes,
    budgets: GatewayResolvedBudget[],
  ): Promise<Map<string, string>> {
    if (this.chRepo === null || budgets.length === 0) {
      return new Map();
    }

    try {
      const tenantIds = await this.budgetDecisions.listSpendTenantIds(vk.organizationId);
      if (tenantIds.length === 0) {
        return new Map();
      }

      // Read each budget's spend from its RESOLVED bucket, exactly. The
      // bundle enforces this key's buckets, so the figure must be the
      // bucket's own: a GROUP budget read from the raw row would prefix-sum
      // every member's bucket, and the gateway would then cap each member
      // at what the whole group spent together.
      const spends = await this.chRepo.getSpendForBudgetsAcrossTenants(
        tenantIds,
        budgets
          // Templates have no single bucket to read; their per-user spend
          // is fetched request-side through the bucket-spend endpoint.
          .filter((r) => r.budget.scopeType !== "ATTRIBUTED_USER")
          .map((r) => ({
            budgetId: r.budget.id,
            scope: r.budget.scopeType,
            scopeId: r.bucketScopeId,
            window: r.budget.window,
            match: "exact" as const,
            periodFloorMs: budgetPeriodFloorMs(r.budget),
          })),
      );
      const out = new Map<string, string>();
      for (const s of spends) {
        out.set(s.budgetId, s.spentUsd);
      }

      return out;
    } catch {
      return new Map();
    }
  }

  /**
   * Every budget applying to this key: org and key scopes always; team and project only when a
   * trace project resolves; principal and per-member group only when the key carries a principal.
   * Scope semantics live in the shared resolver the request-time check also calls.
   */
  private async applicableBudgets(
    vk: VirtualKeyWithScopes,
    traceProject: { id: string; teamId: string } | null,
  ): Promise<GatewayResolvedBudget[]> {
    return this.budgetDecisions.resolveApplicableBudgets({
      organizationId: vk.organizationId,
      virtualKeyId: vk.id,
      teamId: traceProject?.teamId ?? null,
      projectId: traceProject?.id ?? null,
      principalUserId: vk.principalUserId,
    });
  }
}

// Resolves the policy-side of the bundle (model aliases + rules) from the
// VK's RoutingPolicy when present, else the VK config defaults — legacy VK
// config keys are stripped post bug-7 step (iv), so the fallback is always
// empty and the RP read becomes source of truth once routingPolicyId is set.
// Empty-rules normalize to the wire-contracted shape regardless of DB content.
