/**
 * Central registry of every feature flag the application recognizes.
 *
 * Two kinds of entries:
 *
 *  - Flag definition: a single named flag the registry knows by exact key.
 *  - Family: a key prefix (and optional suffix) that matches a set of
 *    dynamically-named flags sharing a scope and default. Event-sourcing
 *    kill switches use this pattern: their keys
 *    (`es-<aggregate>-<component>-<name>-killswitch`) are generated at
 *    runtime from the pipeline graph.
 *
 * Resolution looks up exact keys first, then matches against family
 * prefix+suffix shapes. Anything not registered falls through to the
 * legacy PostHog path so we never silently change behavior for an
 * unknown flag.
 *
 * Scope drives the resolver:
 *   - SYSTEM: env, then postgres, then default. PostHog is never consulted.
 *   - PRODUCT: env, then PostHog, then postgres, then default. PostHog
 *     stays the source of truth for user/A-B targeting; postgres is a
 *     self-hosted and emergency-override fallback.
 *
 * Adding a new flag:
 *   1. Append an entry to FEATURE_FLAGS below with a SYSTEM or PRODUCT
 *      scope and a registry default.
 *   2. Call `featureFlagService.isEnabled(<key>, ...)`. The key is
 *      type-checked against `FeatureFlagKey`, so typos and references
 *      to unregistered flags fail at compile time.
 *   3. Toggle from /ops/feature-flags at runtime without a redeploy.
 *
 * See dev/docs/adr/005-feature-flags.md for the architecture rationale.
 */

export type FeatureFlagScope = "SYSTEM" | "PRODUCT";

export interface FeatureFlagDefinition {
  key: string;
  scope: FeatureFlagScope;
  defaultValue: boolean;
  description: string;
  /** Surface for the operator UI; `null` for product flags. */
  family?: string;
  /**
   * Extra env-var name to honor on top of the auto-derived
   * UPPERCASE(key) name. Used when the flag is migrating from an
   * older, differently-named env var and we want existing operator
   * setups to keep working.
   */
  legacyEnvVar?: string;
}

export interface FeatureFlagFamily {
  keyPrefix: string;
  /**
   * Optional required suffix on top of the prefix. Used to narrow a
   * family to a specific generated shape (e.g. `es-...-killswitch`)
   * so unrelated keys that merely start with the prefix don't get
   * misclassified into the family's scope.
   */
  keySuffix?: string;
  scope: FeatureFlagScope;
  defaultValue: boolean;
  description: string;
  family: string;
}

export const FEATURE_FLAGS = [
  // ----- SYSTEM -----
  // Loop-prevention kill switch (PR #4048). Was a raw process.env read
  // (`LANGWATCH_DISABLE_CAUSALITY_LOOP_GUARD === "1"`), now a registered
  // SYSTEM flag so it can be flipped from the Ops UI without redeploy.
  // Env var still works via the standard env-override path.
  {
    key: "ops_es_causality_loop_guard_disabled",
    scope: "SYSTEM",
    defaultValue: false,
    description:
      "Disables the per-event evaluator causality-loop guard in the trace-processing reactor. Emergency only; bypasses the safeguard that stopped the 2026-05 outage.",
    family: "Event sourcing",
    legacyEnvVar: "LANGWATCH_DISABLE_CAUSALITY_LOOP_GUARD",
  },
  // Strict-PII analysis-service kill switch. The native secrets + essential
  // PII floor in the ingestion pipeline is light and always runs; this only
  // sheds the heavy strict pass that calls the external analysis service
  // (Presidio via langevals). Operators flip it from /ops/feature-flags.
  {
    key: "ops_pii_strict_presidio_redaction_disabled",
    scope: "SYSTEM",
    defaultValue: false,
    description:
      "Skips the strict PII redaction pass that calls the external analysis service (Presidio via langevals). The native secrets and essential PII redaction in the ingestion pipeline are unaffected. Emergency operator override to shed analysis-service load.",
    family: "Collector",
  },
  // Per-span token estimation kill switches. Hardcoded raw keys before;
  // each `record_span` job was a PostHog /flags call for the global key
  // plus another for the project key (~5k calls/day in dogfood at modest
  // traffic). Registering them moves the hot path to env + postgres so
  // the only PostHog traffic is the Ops UI toggle.
  {
    key: "token-estimation-killswitch",
    scope: "SYSTEM",
    defaultValue: false,
    description:
      "Globally disables OTLP span token estimation in the collector. Emergency operator override; enabling skips the model-based token-count fill for spans missing usage metrics.",
    family: "Collector",
  },
  {
    key: "token-estimation-project-killswitch",
    scope: "SYSTEM",
    defaultValue: false,
    description:
      "Per-project (distinctId = project id) disable for OTLP span token estimation. Operators can opt a single tenant out before reaching for the global switch.",
    family: "Collector",
  },

  // ----- PRODUCT -----
  {
    key: "release_ui_sdk_radar_banner_card_enabled",
    scope: "PRODUCT",
    defaultValue: false,
    description: "Shows the SDK radar banner card on the home page.",
  },
  {
    key: "release_ui_ai_gateway_menu_enabled",
    scope: "PRODUCT",
    defaultValue: true,
    description:
      "Surfaces the AI Gateway menu in the project sidebar. Default flipped to on: operators can hide the surface per project via a PostHog rule or operator-store row.",
  },
  // Per-project gate for trace blob offload (#4215 / ADR-022). Checked ONCE per
  // ingestion request (not per span) via the postgres-cached store, so the
  // hot-path cost is one cached lookup. When on, over-threshold spans get
  // routed via the transient S3 spool at the edge (ADR-022). Off = today's
  // behavior — the existing capOversizedAttributes(256 KB) is the only cap.
  {
    key: "release_trace_blob_offload",
    scope: "PRODUCT",
    defaultValue: false,
    description:
      "Routes over-threshold OTLP spans via a transient S3 spool at the ingestion edge (ADR-022). Off = current behavior (full value flows through the command queue; capOversizedAttributes(256 KB) is the only cap).",
  },
  {
    key: "release_ui_ai_governance_enabled",
    scope: "PRODUCT",
    defaultValue: false,
    description:
      "Gates the personal keys, admin oversight, RoutingPolicy, and IngestionSource UI surfaces. Distinct from release_ui_ai_gateway_menu_enabled — the existing gateway product ships unblocked while governance keeps cooking.",
  },
  {
    key: "release_langy_enabled",
    scope: "PRODUCT",
    defaultValue: false,
    description:
      "Enables the Langy in-product assistant. Staff-only gate is layered on top via isLangwatchStaff(); flag off = hidden for everyone including staff.",
  },
] as const satisfies readonly FeatureFlagDefinition[];

export const FEATURE_FLAG_FAMILIES = [
  // Event-sourcing pipeline component kill switches. Names generated by
  // generateKillSwitchKey() in src/server/event-sourcing/utils/killSwitch.ts
  // as `es-<aggregate>-<componentType>-<componentName>-killswitch`. Default
  // is false (component runs) so absence of a row means "let it run".
  // This family is the one that drove the 2026-05 PostHog billing
  // spike: each new (tenant × component) combination minted a fresh
  // cache key.
  {
    keyPrefix: "es-",
    keySuffix: "-killswitch",
    scope: "SYSTEM",
    defaultValue: false,
    description:
      "Per-component kill switch for an event-sourcing projection, map-projection, or command. Setting to true disables that component cluster-wide.",
    family: "Event sourcing",
  },
] as const satisfies readonly FeatureFlagFamily[];

/**
 * Union of every flag key the application can resolve at runtime.
 *
 *  - Registered explicit keys (autocompletes in editors, errors on typo).
 *  - The es-*-killswitch template literal that covers the dynamic
 *    family generated by killSwitch.ts.
 *
 * Use this type wherever a flag key is accepted so the TypeScript
 * compiler keeps unregistered flags out of the build.
 */
export type RegisteredFeatureFlagKey = (typeof FEATURE_FLAGS)[number]["key"];
export type EsKillSwitchKey = `es-${string}-${string}-${string}-killswitch`;
export type FeatureFlagKey = RegisteredFeatureFlagKey | EsKillSwitchKey;

const FLAGS_BY_KEY: Map<string, FeatureFlagDefinition> = new Map(
  FEATURE_FLAGS.map((f) => [f.key, f]),
);

/**
 * Resolve a flag key to its registered definition, preferring exact
 * matches over family-prefix matches. Returns undefined when the key
 * does not appear in either list; callers should fall through to a
 * legacy PostHog evaluation in that case (back-compat for flags that
 * existed before the registry).
 */
export function resolveFlagDefinition(
  key: string,
): FeatureFlagDefinition | undefined {
  const explicit = FLAGS_BY_KEY.get(key);
  if (explicit) return explicit;
  for (const fam of FEATURE_FLAG_FAMILIES) {
    if (!key.startsWith(fam.keyPrefix)) continue;
    if (fam.keySuffix && !key.endsWith(fam.keySuffix)) continue;
    return {
      key,
      scope: fam.scope,
      defaultValue: fam.defaultValue,
      description: fam.description,
      family: fam.family,
    };
  }
  return undefined;
}

export function listFeatureFlags(): readonly FeatureFlagDefinition[] {
  return FEATURE_FLAGS;
}

export function listFeatureFlagFamilies(): readonly FeatureFlagFamily[] {
  return FEATURE_FLAG_FAMILIES;
}
