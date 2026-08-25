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
 * legacy in-memory path so we never silently change behavior for an
 * unknown flag.
 *
 * Scope drives the resolver, though both scopes resolve identically today:
 *   - SYSTEM: env, then postgres, then default.
 *   - PRODUCT: env, then postgres, then default. Postgres targeting rules
 *     (per-project / per-org) are the source of truth for rollout targeting.
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
  /**
   * Set to `false` to opt the flag out of the auto-derived
   * UPPERCASE(key) env-var override, leaving the operator store as the
   * only runtime lever.
   */
  envOverridable?: false;
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
      "Disables the per-event evaluator causality-loop guard in the trace-processing subscriber. Emergency only; bypasses the safeguard that stopped the 2026-05 outage.",
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
  // Kill switch for the evaluator settings recovery (langwatch#6397). The
  // recovery is ON by default: an evaluator whose prompt was stored at the top
  // level of `config` instead of under `config.settings` has it recovered on the
  // online path, instead of being silently dropped and replaced by langevals'
  // own strict default prompt — which scored every trace 0.
  //
  // SYSTEM scope is load-bearing, not incidental. At the time (langwatch#6397),
  // a PRODUCT-scoped flag resolved env -> PostHog -> postgres -> default, so a
  // 0%-rollout PostHog definition would have left the registry default reading
  // `true` while production still ran the old behavior — shipping the fix
  // inert with every test green. PostHog has since been removed from the
  // resolver entirely, but the scope stays pinned as the regression guard.
  {
    key: "ops_evaluator_settings_recovery_disabled",
    scope: "SYSTEM",
    defaultValue: false,
    description:
      "Disables recovery of evaluator settings stored at the top level of `config` on the online evaluation path. While on, such evaluators fall back to `monitor.parameters` and, when that is empty, run against the judge's own default prompt. Emergency operator rollback for langwatch#6397.",
    family: "Event sourcing",
  },
  // Kill switch for the evaluation-inputs offload (ADR-040). The offload is ON
  // by default: oversized evaluator inputs go to the durable stored-objects
  // service and the event/row carry a bounded marker instead of the full
  // payload. Flipping this ON keeps inputs inline (only the unconditional
  // repository cap bounds the ClickHouse row). Operators flip it from
  // /ops/feature-flags.
  {
    key: "ops_evaluation_payload_offload_disabled",
    scope: "SYSTEM",
    defaultValue: false,
    description:
      "Disables the oversized evaluator-inputs offload to durable object storage (ADR-040). While on, inputs flow inline and only the unconditional 8 MiB repository cap bounds the ClickHouse row. Emergency operator override for object-storage trouble.",
    family: "Event sourcing",
  },
  // Per-span token estimation kill switches. Hardcoded raw keys before;
  // each `record_span` job was a PostHog /flags call for the global key
  // plus another for the project key (~5k calls/day in dogfood at modest
  // traffic). Registering them moved the hot path to env + postgres,
  // eliminating that traffic entirely.
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

  // Per-organization gate for pulled provider usage cost (ADR-088). Checked
  // once per pull run, not per usage item. Off by default: with it off the
  // puller behaves exactly as it did before — OCSF audit rows only, no
  // `PulledUsageObserved` event and no ledger row — so enabling is an explicit
  // opt-in for the first provider integration. It is the ADR's stated gate for
  // "new pulled_usage event + ledger write", and the reason it is per-ORG
  // rather than per-project is that pulled usage is attributed at org/team and
  // has no project of its own (Decision 4, deferred).
  {
    key: "release_pulled_usage_cost_enabled",
    scope: "PRODUCT",
    defaultValue: false,
    description:
      "Records cost pulled from a provider's own usage/cost report as a priced record on the customer's usage screens (ADR-088). Off by default; enable per organization via the operator store or a PostHog rule. With it off the puller writes audit rows only. For local dev use FEATURE_FLAG_FORCE_ENABLE=release_pulled_usage_cost_enabled.",
    family: "Governance",
  },

  // ----- PRODUCT -----
  {
    key: "release_lwql_workbench",
    scope: "PRODUCT",
    defaultValue: false,
    description:
      "Gates the whole LangWatchQL surface — the Custom query workbench UI and the analytics.lwql tRPC endpoints — while it is experimental. Off by default; enable per project or organization via a targeting rule, or globally via the operator store.",
  },
  {
    key: "release_ui_ai_gateway_menu_enabled",
    scope: "PRODUCT",
    defaultValue: true,
    description:
      "Surfaces the AI Gateway menu in the project sidebar. Default flipped to on: operators can hide the surface per project via a PostHog rule or operator-store row.",
  },
  {
    key: "release_ui_navigation_v2_enabled",
    scope: "PRODUCT",
    defaultValue: false,
    description:
      "Unlocks the product-scoped navigation shells (spec: specs/navigation/navigation-modes.feature): a per-device mode picker in the avatar menu with legacy, product-switcher and icon-rail values. The flag only unlocks the picker; the device preference decides which shell renders, and flag off or mode legacy keeps the current chrome unchanged. Default off. Force-enable in dev via FEATURE_FLAG_FORCE_ENABLE=release_ui_navigation_v2_enabled.",
  },
  // Per-project gate for the transient S3 spool at the ingestion edge
  // (#4215 / ADR-022). ON by default, so a deployment with object storage
  // configured keeps oversized span content intact with no flag setup: a span
  // whose serialized command exceeds 256 KB is written to the spool and the
  // queued command carries only a spool ref. Resolved per span against the
  // postgres-cached store, so the hot-path cost is one cached lookup.
  //
  // The flag stays the kill switch and the per-project opt-out: an operator
  // row in /ops/feature-flags turns the spool off fleet-wide or for a single
  // project. When the spool cannot run at all (no reachable object storage,
  // or an Azure-only install where the S3 client refuses to build) the edge
  // fails open: ingestion proceeds inline and capOversizedAttributes truncates
  // each attribute value at 256 KB.
  {
    key: "release_trace_blob_offload",
    scope: "PRODUCT",
    defaultValue: true,
    description:
      "Routes over-threshold OTLP spans through a transient S3 spool at the ingestion edge so oversized attribute values reach the trace intact (ADR-022). On by default; switch it off fleet-wide or per project to keep spans inline, where the 256 KB per-value cap applies. Deployments with no reachable object storage keep ingesting either way: the edge falls back inline and the same 256 KB cap applies.",
  },
  // Externalizes inline media (base64 audio turns, data-URI images, file
  // attachments) from span attributes into the content-addressed
  // stored-objects store at the ingestion edge, before the command is staged.
  // Fail-open by construction (any error keeps the original inline payload)
  // and skipped for projects with data-privacy content-drop rules.
  //
  // Default OFF: the stored-objects store is not yet covered by the
  // data-retention deletion path or the storage meter, so extracted media
  // would outlive the trace's retention policy uncounted. The default flips
  // on once stored-objects retention lands (#5951); until then the flag is a
  // per-project / per-deployment opt-in.
  {
    key: "release_trace_media_extraction",
    scope: "PRODUCT",
    defaultValue: false,
    description:
      "Externalizes inline media (audio, images, files) from span content into the content-addressed stored-objects store at the ingestion edge, replacing base64 payloads with /api/files references. Off = media stays inline through the pipeline as before. Note: stored media is not yet covered by retention deletion; enable knowingly.",
  },
  // ADR-116 §3. The allowlist for the born-finalized entrance: a sign-up on
  // a flag-listed organization is created ON the identity branch — its
  // identifier history goes into the event log and its migration state is
  // finalized before sign-up returns — instead of being created on the
  // legacy branch and migrated off it later.
  //
  // Default OFF, and it must stay off until the entrance is hardened: a
  // flagged sign-up is deliberately COUPLED to engine availability and fails
  // loudly (`identity_engine_unavailable`) when the event stack is down,
  // rather than falling back. That coupling is acceptable only while the
  // population is an operator-chosen allowlist. Target it with a store
  // targeting rule per organization; the env override is the dev-loop lever.
  {
    key: "release_identity_born_finalized_signup",
    scope: "PRODUCT",
    defaultValue: false,
    description:
      "Creates new users directly on the identity branch: their sign-in history is recorded as identity events and their migration state is finalized as part of sign-up, instead of being backfilled afterwards. Off = new users are created exactly as before. Sign-up on a targeted organization fails rather than falling back when the event-sourcing stack is unavailable, so enable it per organization, knowingly.",
  },
  {
    key: "release_ui_ai_governance_enabled",
    scope: "PRODUCT",
    // On by default (ADR-038 Decision 7): self-hosted installations get
    // governance (AI-tools device login, /me, admin surfaces, the
    // onboarding intent fork, the org "Primary use" setting) with zero
    // configuration. Two off-switches with different blast radii: an
    // operator store row targets per organization, while
    // RELEASE_UI_AI_GOVERNANCE_ENABLED=0 is deployment-wide — it is
    // evaluated before store targeting and disables the flag for every
    // context in the process, so it cannot re-arm the gate for just one
    // org. This default and the auth-cli device-login fallback are a
    // pinned pair, move them together (governanceGaDefaults.unit.test.ts
    // enforces it).
    defaultValue: true,
    description:
      "Gates the personal keys, admin oversight, RoutingPolicy, IngestionSource UI surfaces, the onboarding intent fork, and the org Primary use setting (ADR-038). On by default; switch off per org via the operator store (or deployment-wide via RELEASE_UI_AI_GOVERNANCE_ENABLED=0) to hide governance and refuse AI-tools device login. Distinct from release_ui_ai_gateway_menu_enabled: the gateway product ships on its own flag.",
  },
  {
    key: "release_ui_governance_billed_cost_enabled",
    scope: "PRODUCT",
    defaultValue: false,
    description:
      "Reveals the Costs and Billed governance placeholder pages and their sidebar items (spec: specs/ai-gateway/governance/governance-home-routing.feature). Composed ON TOP of release_ui_ai_governance_enabled, never instead of it: the section flag off still hides everything. Default off — the pages are empty shells shipped ahead of the spend views. Enable per organization via the operator store; for local dev use FEATURE_FLAG_FORCE_ENABLE=release_ui_governance_billed_cost_enabled.",
    family: "Governance",
  },
  // ADR-034 Phase 3 — routes analytics getTimeseries reads to the slim
  // `trace_analytics` / rollup `trace_analytics_rollup` tables (Phases 1+2)
  // when the query shape allows. OFF (default) = legacy trace_summaries reads
  // unchanged. The router (`pickAnalyticsTable`) is the SINGLE place that
  // chooses; this flag gates whether the router runs at all per project.
  {
    key: "release_event_sourced_analytics_read",
    scope: "PRODUCT",
    defaultValue: false,
    description:
      "Routes analytics getTimeseries reads to the slim trace_analytics / rollup trace_analytics_rollup tables (ADR-034 Phases 1+2) when the query shape allows. Off = legacy trace_summaries reads unchanged.",
  },
  // ADR-034 Phase 3 tripwire — when ON, runs both the routed query AND the
  // legacy `trace_summaries` query in parallel and logs a structured warning
  // on divergence beyond a small numeric tolerance. Returns the routed result
  // either way; thin wrapper, no read-path duplication beyond the comparison.
  // Disabled by default; flipped on per-project during canary.
  {
    key: "release_event_sourced_analytics_read_tripwire",
    scope: "PRODUCT",
    defaultValue: false,
    description:
      "Tripwire for ADR-034 Phase 3: when ON alongside release_event_sourced_analytics_read, runs the routed and legacy trace_summaries queries in parallel and logs divergence beyond a small tolerance. Returns the routed result either way.",
  },
  // NOTE: `release_es_graph_triggers_firing` (ADR-034 Phase 5) was retired —
  // the event-sourced graph-alert path is now unconditional and the K8s cron
  // was removed, so there is no longer a cron/ES choice to gate.
  // SYSTEM on purpose despite being a product surface: the Langy rollout is
  // decided solely by the internal flag store — never an env var
  // (envOverridable: false) — so the /ops/feature-flags toggle is the one
  // authoritative lever.
  {
    key: "release_langy_enabled",
    scope: "SYSTEM",
    defaultValue: false,
    envOverridable: false,
    family: "Langy",
    description:
      "Opens the Langy in-product assistant, and is the only lever that does — there is no staff or other identity bypass, so this is a true kill switch. Default off, so Langy is dark until someone is explicitly opted in. Managed only from the internal flag store: toggle it, or add per-project/per-org targeting rules, via /ops/feature-flags. PostHog and the RELEASE_LANGY_ENABLED env var are deliberately not consulted. For local dev use FEATURE_FLAG_FORCE_ENABLE=release_langy_enabled.",
  },
  {
    key: "release_langy_api_key_turns_enabled",
    scope: "SYSTEM",
    defaultValue: false,
    envOverridable: false,
    family: "Langy",
    description:
      "Lets a project API key start and continue Langy turns over the public REST surface (spec: specs/langy/langy-api-key-turns.feature). Strictly narrower than release_langy_enabled and ANDed with it: this flag opens a new way in for an actor who already has Langy, and never grants Langy itself. Off = the REST surface 404s and only the browser can start a turn, which is the rollback position — turning it off cannot break the in-product assistant. Internal flag store only, so the /ops/feature-flags toggle is the one lever.",
  },
  {
    key: "release_langy_pi_harness",
    scope: "SYSTEM",
    defaultValue: true,
    envOverridable: false,
    family: "Langy",
    description:
      "Runs Langy turns on the pi worker harness instead of opencode. Evaluated once per turn and rides the worker credential signature, so flipping it re-warms the conversation's worker on the next message rather than mutating a running one. Default ON = pi everywhere; the flag is the per-project rollback lever to opencode. Managed only from the internal flag store (/ops/feature-flags); PostHog and env vars are not consulted.",
  },
  {
    key: "release_langy_ui_actions",
    scope: "SYSTEM",
    defaultValue: true,
    envOverridable: false,
    family: "Langy",
    description:
      "Lets the agent drive the open page through typed UI actions (spec: specs/langy/langy-ui-actions.feature): `langwatch ui call` dispatches a manifest-validated action over the turn's live stream, the attached page claims and executes it, and the result returns to the agent in the same call. Off = the dispatch surface 404s like it was never deployed and the panel ignores `ui` stream entries; the rollback position loses live page control and nothing else. Managed only from the internal flag store (/ops/feature-flags).",
  },
  {
    key: "release_langy_promo_enabled",
    scope: "PRODUCT",
    defaultValue: false,
    description:
      "Shows the Langy teaser banner on the home page to users who do NOT have Langy yet (spec: specs/home/langy-home-banner.feature). Purely promotional — it never grants access; users who already have Langy (staff or release_langy_enabled) see the activation banner instead, regardless of this flag. Target the promo audience via a PostHog rule.",
  },
  {
    key: "release_ui_home_signal_focused_enabled",
    scope: "PRODUCT",
    defaultValue: false,
    description:
      "Switches the project home to the signal-focused composition — the briefing sheet leads, the chrome grid and recent work follow (spec: specs/home/signal-focused-home-rollout.feature). Deliberately decoupled from release_langy_enabled: this flag alone decides the home's composition, while Langy access only decides whether the sheet's hand-to-Langy affordances render. Default off = classic home. Force-enable in dev via FEATURE_FLAG_FORCE_ENABLE=release_ui_home_signal_focused_enabled.",
  },
  {
    key: "release_ui_comparison_leaderboard_enabled",
    scope: "PRODUCT",
    defaultValue: false,
    description:
      "Adds a Bradley-Terry ranking chart (issue #5103) to the Comparison evaluator's charts on the experiments-v3 results page, alongside the existing win-rate chart — a compact card with an expand affordance opening the full leaderboard table, win-matrix heatmap, and cost/duration tradeoff scatter (spec: specs/experiments/comparison-leaderboard.feature). Only mounts once a Comparison has 3+ variants; below that the plain win-rate chart already tells the whole story. Default off — power-user surface, additive to the existing chart. Force-enable in dev via FEATURE_FLAG_FORCE_ENABLE=release_ui_comparison_leaderboard_enabled.",
  },
  {
    key: "release_ui_langy_peek_dock_enabled",
    scope: "PRODUCT",
    defaultValue: false,
    family: "Langy",
    description:
      "Minimising Langy sinks the panel to an edge peek of itself — a sliver of the card at the bottom edge (floating) or of the dock's spine at the right edge (sidebar) that rises on pointer proximity and opens on click (spec: specs/langy/langy-peek-dock.feature). Off = the classic corner launcher orb. Only the closed-state affordance changes; the panel and its Cmd/Ctrl+I activation are the same either way. Force-enable in dev via FEATURE_FLAG_FORCE_ENABLE=release_ui_langy_peek_dock_enabled.",
  },
  {
    key: "release_ui_agent_testing_v2_enabled",
    scope: "PRODUCT",
    defaultValue: false,
    description:
      "Unlocks Agent Testing, the v2 interface for simulations (specs under specs/features/agent-testing/): one page with the test cases and the results in tabs, test suites as folders of test cases, run notes, test case versions, and a wider run drawer that puts the results beside the conversation. Flag off leaves the current Simulations pages and menu group exactly as they are; the flag only decides which interface renders, and the backend additions it uses are unflagged. Default off. Force-enable in dev via FEATURE_FLAG_FORCE_ENABLE=release_ui_agent_testing_v2_enabled.",
  },
  {
    key: "release_webhook_automations",
    scope: "PRODUCT",
    defaultValue: false,
    description:
      "Offers the Webhook (generic HTTP request) delivery channel for automations (ADR-040). Gates the delivery-picker card, the save route accepting SEND_WEBHOOK, and the test-fire path. Force-enable in dev via FEATURE_FLAG_FORCE_ENABLE=release_webhook_automations.",
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
 * legacy in-memory evaluation in that case (back-compat for flags that
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
