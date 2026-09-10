import { type Instant, toDate } from "@langwatch/time";
/**
 * The wire shapes the Go data plane reads, and the pure mapping from control-plane rows onto them.
 * Nothing here reads a store: a materialisation gathers the rows, and this decides what each one
 * looks like in the bundle.
 */

import type { GatewayBudget, ModelProvider, VirtualKey } from "@langwatch/gateway-contract";
import type { VirtualKeyWithScopes } from "@langwatch/gateway-contract";
import type {
  GatewayCacheRuleResource,
  GatewayConfigGuardrailAttachment,
  GatewayGuardrailBundleEntry,
  GatewayMoney,
  GatewayResolvedBudget,
} from "@langwatch/gateway-contract";
import {
  effectiveBudgetPeriod,
  parseVirtualKeyConfig,
  type GatewayBudgetResource,
} from "@langwatch/gateway-contract";
import type { LangyMirrorTier } from "@langwatch/langy-contract";
import { modelProviders } from "@langwatch/model-provider-contract";
import type { GatewayConfigAssembly } from "../app/gateway.members.ts";
import type { GatewayModelProviderCredentials } from "../app/gateway.members.ts";

export type GuardrailWire = {
  id: string;
  name: string;
  evaluator_id: string;
  evaluator_slug: string | null;
  direction: "pre" | "post" | "stream_chunk";
  failure_mode: "fail_open" | "fail_closed";
};

export type GuardrailAttachmentWire = {
  direction: "pre" | "post" | "stream_chunk";
  guardrail_ids: string[];
};

export type ProviderSlot = {
  /**
   * ModelProvider.id — the Go gateway keys credentials on this directly
   * post-collapse (was the GPC id pre-collapse; one-to-one fold means
   * the wire name `id` stays the same).
   */
  id: string;
  slot: string;
  type: string;
  /**
   * Opaque per-provider credentials blob, matching the Go gateway's key shape for each provider
   * type: an API key for the direct vendors, plus endpoint and version for Azure, the access pair
   * and region for Bedrock, and project and credentials for Vertex. Decrypted from the row.
   */
  credentials: Record<string, unknown>;
  base_url?: string;
  region?: string;
  deployment_map?: Record<string, string>;
  /**
   * Operator-chosen routing handle for this provider row: a caller writes it where a provider
   * family goes to reach this instance rather than whichever the key's chain order reaches first.
   * Absent when the operator set none.
   */
  handle?: string;
  /**
   * What this provider declares it serves, for routing a bare model name to its owner. Absent
   * means it said nothing, not that it serves nothing: authorization stays with the allowed models.
   */
  models?: string[];
  config: Record<string, unknown>;
};

/**
 * A provider row the gateway will not dispatch to, named so a request-time block can say why. The
 * type travels alongside the row id, since the gateway matches a resolved request by provider kind
 * and these rows are absent from the dispatch list.
 */
export type ProviderExclusionWire = {
  id: string;
  type: string;
  /**
   * The dropped row's routing handle, carried so a request naming it is told
   * which of the key's settings dropped the provider instead of being told the
   * operator's own handle means nothing.
   */
  handle?: string;
};

export type GatewayConfigPayload = {
  revision: string;
  vk_id: string;
  status: "active" | "revoked";
  display_prefix: string;
  organization_id: string;
  /**
   * The trace destination fields populate when the key has a single project scope, or the org has
   * an internal governance project that team- and org-scoped keys route traces to. Null for older
   * self-hosted orgs, where the gateway skips span export rather than failing the config fetch.
   */
  project_id: string | null;
  project_otlp_token: string | null;
  team_id: string | null;
  principal_id: string | null;
  providers: ProviderSlot[];
  /**
   * `chain` is the ordered provider slots; `max_attempts` bounds the walk.
   * Which failures walk it is decided by the gateway from the real upstream
   * outcome, never per key.
   */
  fallback: {
    chain: string[];
    max_attempts: number;
  };
  model_aliases: Record<string, string>;
  models_allowed: string[] | null;
  /**
   * Explicit provider allowlist. Null means every provider the key can reach through its scope
   * graph, now and in future, so a provider added next month is usable unedited. A list narrows to
   * those ids, and ships so the gateway can say why a model is unavailable.
   */
  providers_allowed: string[] | null;
  /**
   * How the key behaves when its provider fails: no failover, walking every eligible provider, or
   * letting the linked routing policy decide.
   */
  routing_mode: "none" | "fallback_all" | "policy";
  /**
   * Providers a request could resolve to but the gateway will not dispatch to, split by why and
   * each carrying the id and type the dispatch list uses: one dropped by the routing policy, the
   * other outside the allowlist. Absent from both and from the dispatch list means unreachable.
   */
  routing_excluded_providers: ProviderExclusionWire[];
  access_excluded_providers: ProviderExclusionWire[];
  /**
   * Display name of the key's routing policy, used to name the routing-block
   * reason. Null when the key is not on a routing policy.
   */
  routing_policy_name: string | null;
  cache: { mode: "respect" | "force" | "disable"; ttl_s: number };
  // Flat per-project guardrail catalog the VK is allowed to reference.
  // The Go dispatcher looks up entries by id from guardrail_attachments
  // and invokes them per direction.
  guardrails: GuardrailWire[];
  guardrail_attachments: GuardrailAttachmentWire[];
  policy_rules: {
    tools: { deny: string[]; allow: string[] | null };
    mcp: { deny: string[]; allow: string[] | null };
    urls: { deny: string[]; allow: string[] | null };
    models: { deny: string[]; allow: string[] | null };
  };
  rate_limits: {
    rpm: number | null;
    tpm: number | null;
    rpd: number | null;
  };
  budgets: Array<{
    id: string;
    scope:
      | "organization"
      | "team"
      | "project"
      | "virtual_key"
      | "principal"
      | "group"
      | "attributed_user";
    /**
     * The bucket spend accumulates under. Equal to the budget's target for
     * every scope except "group", where it is `<groupId>:<userId>` so each
     * member of a group gets their own allowance.
     */
    scope_id: string;
    /** Only set for "group": the member this bucket belongs to. */
    principal_id?: string;
    /**
     * Only set for an attributed-user budget, where the entry is a template carrying the per-window
     * limit for each distinct end user on this anchor. The scope id stays the anchor: per-user
     * spend is unbounded cardinality, so the gateway fetches the request's bucket on demand.
     */
    per_user?: true;
    /**
     * Provider filter. Null means the budget counts every dispatch; set, it counts and constrains
     * only dispatches to that provider, so a breach removes that provider from the chain instead
     * of blocking the whole request.
     */
    provider_key: string | null;
    window: string;
    limit_micro_usd: number;
    spent_micro_usd: number;
    resets_at: number;
    on_breach: "block" | "warn";
  }>;
  cache_rules: Array<{
    id: string;
    priority: number;
    matchers: {
      vk_id?: string;
      vk_tags?: string[];
      vk_prefix?: string;
      principal_id?: string;
      model?: string;
      request_metadata?: Record<string, string>;
    };
    action: {
      mode: "respect" | "force" | "disable";
      ttl?: number;
      salt?: string;
    };
  }>;
  /**
   * ADR-061 mirror tier. Present and non-skip only for Langy virtual keys, so the gateway never
   * mirrors ordinary customer traffic. Read here rather than from a client header to decide
   * whether to duplicate the span into the mirror project.
   */
  langy_mirror_tier: LangyMirrorTier;
  metadata: Record<string, unknown>;
  // The VK's operator-assigned tags, lifted from config.metadata.tags.
  // The gateway stamps them on customer spans as langwatch.labels (Trace
  // Explorer "Label" filter) and matches cache-rule vk_tags against them.
  vk_tags: string[];
  /**
   * The key's expiry in unix seconds, null if never, always present so the gateway can tell an
   * explicit null from a field an older control plane never sent. It also travels on the auth
   * token; carrying it here bounds how long a stale value can be held, since the ETag moves.
   */
  expires_at: number | null;
};

export type BundlePolicyRules = GatewayConfigPayload["policy_rules"];

const EMPTY_POLICY_RULE_DIM = {
  deny: [] as string[],
  allow: null as string[] | null,
};

export function emptyPolicyRules(): BundlePolicyRules {
  return {
    tools: { ...EMPTY_POLICY_RULE_DIM },
    mcp: { ...EMPTY_POLICY_RULE_DIM },
    urls: { ...EMPTY_POLICY_RULE_DIM },
    models: { ...EMPTY_POLICY_RULE_DIM },
  };
}

export function mergePolicyDim(raw: unknown): {
  deny: string[];
  allow: string[] | null;
} {
  if (!raw || typeof raw !== "object") {
    return { ...EMPTY_POLICY_RULE_DIM };
  }

  const r = raw as { deny?: unknown; allow?: unknown };
  const deny = Array.isArray(r.deny)
    ? r.deny.filter((x): x is string => typeof x === "string")
    : [];
  const allow =
    r.allow === null || r.allow === undefined
      ? null
      : Array.isArray(r.allow)
        ? r.allow.filter((x): x is string => typeof x === "string")
        : null;

  return { deny, allow };
}

export function normalisePolicyRules(raw: unknown): BundlePolicyRules {
  if (!raw || typeof raw !== "object") {
    return emptyPolicyRules();
  }

  const r = raw as Record<string, unknown>;

  return {
    tools: mergePolicyDim(r.tools),
    mcp: mergePolicyDim(r.mcp),
    urls: mergePolicyDim(r.urls),
    models: mergePolicyDim(r.models),
  };
}

export function resolvePolicySideOfBundle(
  vk: VirtualKeyWithScopes,
  _config: ReturnType<typeof parseVirtualKeyConfig>,
  assembly: GatewayConfigAssembly,
): {
  modelAliases: Record<string, string>;
  policyRules: BundlePolicyRules;
} {
  const rp = vk.routingPolicy;
  if (!rp) {
    return { modelAliases: {}, policyRules: emptyPolicyRules() };
  }

  const aliasesRaw = rp.modelAliases;
  const aliases: Record<string, string> =
    aliasesRaw && typeof aliasesRaw === "object" && !Array.isArray(aliasesRaw)
      ? Object.fromEntries(
          Object.entries(aliasesRaw as Record<string, unknown>).filter(
            ([, v]) => typeof v === "string",
          ) as Array<[string, string]>,
        )
      : {};

  return {
    modelAliases: assembly.withTierFallthrough({
      aliases,
      defaultModel: rp.defaultModel,
    }),
    policyRules: normalisePolicyRules(rp.policyRules),
  };
}

export function buildProviderSlot(
  mp: ModelProvider,
  index: number,
  credentialReader: GatewayModelProviderCredentials,
  assembly: GatewayConfigAssembly,
): ProviderSlot {
  const credentials = assembly.buildCredentials(mp, credentialReader);
  const customKeys = credentialReader.readCustomKeys(mp.customKeys);
  // Base-URL override the gateway consumes (mapProvider in bifrost.go):
  // "custom"/"openai" route to Bifrost's VLLM adapter; "anthropic" derives
  // a custom provider for self-hosted /v1/messages; "elevenlabs" needs it
  // for realtime session residency. Registry indexed by the narrowed literal,
  // so a losing endpointKey entry fails here, not by silently emitting no base_url.
  const endpointKey =
    mp.provider === "custom" ||
    mp.provider === "openai" ||
    mp.provider === "anthropic" ||
    mp.provider === "elevenlabs"
      ? modelProviders[mp.provider].endpointKey
      : undefined;
  const registryBaseURL = endpointKey ? pickString(customKeys, endpointKey) : undefined;
  const baseURL =
    pickString(customKeys, "base_url") ?? pickString(customKeys, "BASE_URL") ?? registryBaseURL;
  const region = pickString(credentials, "region");
  const deploymentMap = mp.deploymentMapping
    ? (mp.deploymentMapping as Record<string, string>)
    : undefined;

  return {
    id: mp.id,
    slot: index === 0 ? "primary" : `fallback_${index}`,
    type: mp.provider,
    credentials,
    ...(baseURL ? { base_url: baseURL } : {}),
    ...(region ? { region } : {}),
    ...(deploymentMap ? { deployment_map: deploymentMap } : {}),
    ...routingWire({ mp, assembly }),
    config: buildProviderConfig(mp),
  };
}

/**
 * Routing half of a provider slot: the handle addressing this exact instance, and the models it
 * declares served. Both absent, rather than empty, means there is nothing to say — read as said
 * nothing, not serves nothing.
 */
export function routingWire({
  mp,
  assembly,
}: {
  mp: ModelProvider;
  assembly: GatewayConfigAssembly;
}): Pick<ProviderSlot, "handle" | "models"> {
  const models = assembly.tryDeclaredModelsForProvider(mp);

  return {
    ...(mp.routingHandle ? { handle: mp.routingHandle } : {}),
    ...(models ? { models } : {}),
  };
}

function pickString(obj: Record<string, unknown>, key: string): string | undefined {
  const v = obj[key];

  return typeof v === "string" && v.length > 0 ? v : undefined;
}

export function buildProviderConfig(mp: ModelProvider): Record<string, unknown> {
  const gatewayExtras = (mp.providerConfig ?? {}) as Record<string, unknown>;

  return {
    rate_limit: {
      rpm: mp.rateLimitRpm,
      tpm: mp.rateLimitTpm,
      rpd: mp.rateLimitRpd,
    },
    health: {
      status: mp.healthStatus.toLowerCase(),
      circuit_opened_at: mp.circuitOpenedAt ? toDate(mp.circuitOpenedAt).toISOString() : null,
    },
    ...(mp.extraHeaders ? { extra_headers: mp.extraHeaders as Record<string, unknown> } : {}),
    ...gatewayExtras,
  };
}

export function scopeToWire(
  scope: GatewayBudget["scopeType"],
): GatewayConfigPayload["budgets"][number]["scope"] {
  switch (scope) {
    case "ORGANIZATION":
      return "organization";
    case "TEAM":
      return "team";
    case "PROJECT":
      return "project";
    case "VIRTUAL_KEY":
      return "virtual_key";
    case "PRINCIPAL":
      return "principal";
    case "GROUP":
      return "group";
    case "ATTRIBUTED_USER":
      return "attributed_user";
  }
}

export function routingModeToWire(
  mode: VirtualKey["routingMode"],
): GatewayConfigPayload["routing_mode"] {
  switch (mode) {
    case "NONE":
      return "none";
    case "FALLBACK_ALL":
      return "fallback_all";
    case "POLICY":
      return "policy";
  }
}

export function providerExclusionWire(mp: ModelProvider): ProviderExclusionWire {
  return {
    id: mp.id,
    type: mp.provider,
    ...(mp.routingHandle ? { handle: mp.routingHandle } : {}),
  };
}

/**
 * The key's expiration as the gateway reads it: unix seconds, matching the token claim, and null
 * if never. Milliseconds would put the date tens of thousands of years out and lift the expiry cap
 * off the key.
 */
export function expiresAtWire(expiresAt: Instant | null): number | null {
  return expiresAt ? Math.floor(expiresAt.epochMilliseconds / 1000) : null;
}

/**
 * Splits the scope-reachable providers the dispatch chain drops into the two reasons named at
 * request time: the routing policy dropped it, or provider access did. A dispatching provider is
 * in neither list.
 */
export function providerExclusions({
  scopeReachable,
  eligibleProviders,
  allowed,
}: {
  scopeReachable: ModelProvider[];
  eligibleProviders: ModelProvider[];
  allowed: string[] | null;
}): { routingExcluded: ModelProvider[]; accessExcluded: ModelProvider[] } {
  const dispatchIds = eligibleProviders.map((mp) => mp.id);
  const routingExcluded = scopeReachable.filter(
    (mp) => (!allowed || allowed.includes(mp.id)) && !dispatchIds.includes(mp.id),
  );
  const accessExcluded = allowed ? scopeReachable.filter((mp) => !allowed.includes(mp.id)) : [];

  return { routingExcluded, accessExcluded };
}

export type BudgetWire = GatewayConfigPayload["budgets"][number];

/**
 * Current-period figure the bundle ships for one budget. Templates carry no aggregate, spend being
 * per end-user bucket and fetched on demand; every other scope takes the ClickHouse rollup when
 * loaded and the Postgres column when not.
 */
export function budgetSpentMicroUSD(
  budget: GatewayBudgetResource,
  spendByBudgetId: Map<string, string>,
): number {
  if (budget.scopeType === "ATTRIBUTED_USER") {
    return 0;
  }

  const rollup = spendByBudgetId.get(budget.id);

  return rollup === undefined
    ? decimalToMicroUSD(budget.spentUsd)
    : decimalUSDStringToMicroUSD(rollup);
}

export function budgetToWire(
  { budget: b, bucketScopeId, principalUserId }: GatewayResolvedBudget,
  spendByBudgetId: Map<string, string>,
): BudgetWire {
  return {
    id: b.id,
    scope: scopeToWire(b.scopeType),
    scope_id: bucketScopeId,
    ...(principalUserId ? { principal_id: principalUserId } : {}),
    ...(b.scopeType === "ATTRIBUTED_USER" ? { per_user: true as const } : {}),
    provider_key: b.providerKey,
    window: b.window.toLowerCase(),
    limit_micro_usd: decimalToMicroUSD(b.limitUsd),
    spent_micro_usd: budgetSpentMicroUSD(b, spendByBudgetId),
    // The boundary this budget is actually heading for, not the stored
    // column, which only moves at create and at an explicit reset.
    resets_at: Math.floor(effectiveBudgetPeriod(b).resetsAt.epochMilliseconds / 1000),
    on_breach: b.onBreach === "BLOCK" ? "block" : "warn",
  };
}

export type CacheRuleWire = GatewayConfigPayload["cache_rules"][number];

export function cacheRuleToWire(rule: GatewayCacheRuleResource): CacheRuleWire {
  return {
    id: rule.id,
    priority: rule.priority,
    matchers: rule.matchers,
    action: rule.action,
  };
}

export function guardrailToWire(entry: GatewayGuardrailBundleEntry): GuardrailWire {
  return {
    id: entry.id,
    name: entry.name,
    evaluator_id: entry.evaluatorId,
    evaluator_slug: entry.evaluatorSlug,
    direction: entry.direction,
    failure_mode: entry.failureMode,
  };
}

export function guardrailAttachmentToWire(
  attachment: GatewayConfigGuardrailAttachment,
): GuardrailAttachmentWire {
  return { direction: attachment.direction, guardrail_ids: attachment.guardrailIds };
}

/**
 * `GatewayMoney` is the contract's database-library-free decimal: it answers
 * its exact value as a string and nothing more, so the conversion goes through
 * the same string parse the ClickHouse rollup takes.
 */
export function decimalToMicroUSD(d: GatewayMoney): number {
  return decimalUSDStringToMicroUSD(d.toString());
}

export function decimalUSDStringToMicroUSD(s: string): number {
  const n = Number.parseFloat(s);
  if (!Number.isFinite(n)) {
    return 0;
  }

  return Math.round(n * 1_000_000);
}
