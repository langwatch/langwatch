/**
 * Central registry of feature flags; unknown keys resolve to caller default.
 * Add a flag and call isEnabled(<key>, ...).
 */

import type { FeatureFlagExperiment } from "./feature-flag-experiment.ts";

export type FeatureFlagScope = "SYSTEM" | "PRODUCT";

export interface FeatureFlagDefinition {
  key: string;
  scope: FeatureFlagScope;
  defaultValue: boolean;
  description: string;
  /** Surface for the operator UI; `null` for product flags. */
  family?: string;
  /**
   * Extra env-var name to honor on top of the auto-derived UPPERCASE(key)
   * name, for a flag migrating from an older, differently-named env var.
   */
  legacyEnvVar?: string;
  /**
   * Set to `false` to opt the flag out of the auto-derived
   * UPPERCASE(key) env-var override, leaving the operator store as the
   * only runtime lever.
   */
  envOverridable?: false;
  /**
   * Present when the flag is a user-selectable experiment. Its effective
   * value is then base availability combined with tenant policy and the
   * individual's opt-in, rather than availability alone.
   */
  experiment?: FeatureFlagExperiment;
}

export interface FeatureFlagFamily {
  keyPrefix: string;
  /**
   * Optional required suffix narrowing a family to a specific generated
   * shape (e.g. `es-...-killswitch`), so unrelated keys sharing the
   * prefix aren't misclassified into it.
   */
  keySuffix?: string;
  scope: FeatureFlagScope;
  defaultValue: boolean;
  description: string;
  family: string;
}

export const FEATURE_FLAGS = [
  // ----- SYSTEM -----
  {
    key: "es-observability-anomaly-detection-killswitch",
    scope: "SYSTEM",
    defaultValue: false,
    description:
      "Disables anomaly detection and tenant-rate tracking without disabling the rest of the observability pipeline.",
    family: "Observability",
  },
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
  // Kill switch for the evaluator settings recovery (langwatch#6397): without
  // it, a prompt stored at the top level of `config` was silently dropped and
  // replaced by langevals' strict default, which scored every trace 0.
  {
    key: "ops_evaluator_settings_recovery_disabled",
    scope: "SYSTEM",
    defaultValue: false,
    description:
      "Disables recovery of evaluator settings stored at the top level of `config` on the online evaluation path. While on, such evaluators fall back to `monitor.parameters` and, when that is empty, run against the judge's own default prompt. Emergency operator rollback for langwatch#6397.",
    family: "Event sourcing",
  },
  {
    key: "ops_evaluation_payload_offload_disabled",
    scope: "SYSTEM",
    defaultValue: false,
    description:
      "Disables the oversized evaluator-inputs offload to durable object storage (ADR-040). While on, inputs flow inline and only the unconditional 8 MiB repository cap bounds the ClickHouse row. Emergency operator override for object-storage trouble.",
    family: "Event sourcing",
  },
  // Per-span token estimation kill switches resolve locally on the hot path.
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
      "Per-project disable for OTLP span token estimation. Operators can opt a single tenant out before reaching for the global switch.",
    family: "Collector",
  },

  // Per-organization gate for pulled provider usage cost (ADR-088),
  // checked once per pull run, not per item. Per-ORG rather than
  // per-project because pulled usage has no project of its own
  // (Decision 4, deferred).
  {
    key: "release_pulled_usage_cost_enabled",
    scope: "PRODUCT",
    defaultValue: false,
    description:
      "Records cost pulled from a provider's own usage report on the customer's usage screens (ADR-088). Off by default; enable per organization through an operator rule. With it off the puller writes audit rows only.",
    family: "Governance",
  },

  // Deliberately its own key, not a reuse of the flag above: that one gates
  // whether pulled cost is RECORDED, this one whether a superseded charge
  // is WITHDRAWN — one switch would make stopping bad withdrawals also stop
  // every good record.
  {
    key: "release_pulled_usage_retraction_enabled",
    scope: "PRODUCT",
    defaultValue: false,
    description:
      "Withdraws the superseded version of a pulled charge when a provider reissues it under a different currency, agent or spender, so a day does not total the same bill twice (ADR-088/ADR-128). Off by default; enable per organization via the operator store or a PostHog rule. With it off the reissue is still detected and logged, but nothing is withdrawn and the day keeps double-counting. For local dev use FEATURE_FLAG_FORCE_ENABLE=release_pulled_usage_retraction_enabled.",
    family: "Governance",
  },

  // ----- PRODUCT -----
  {
    key: "release_instant_evals",
    scope: "PRODUCT",
    defaultValue: false,
    description:
      "Gates the LangWatchQL eval functions, the judged columns that classify a conversation, a trace or any text a query projects, while they are experimental. Off by default; enable per project or organization via a targeting rule. A deployment with no classifier configured keeps them unavailable whatever this says.",
  },
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
      "Surfaces the AI Gateway menu in the project sidebar. On by default; operators can hide it per project with a targeting rule.",
  },
  {
    key: "release_ui_beta_annotations_trained_enabled",
    scope: "PRODUCT",
    defaultValue: false,
    legacyEnvVar: "NEXT_PUBLIC_FEATURE_BETA_ANNOTATIONS_TRAINED",
    description:
      "Offers the trained annotations evaluator in evaluator selection. Off by default; operators can enable it per project or organization.",
  },
  {
    key: "release_voice_agents_enabled",
    scope: "PRODUCT",
    defaultValue: false,
    description:
      "Voice agents: register an ElevenLabs agent, talk to it, call it from a run, and run scenarios with a simulated caller. Off by default; enable per project or organization via the operator store.",
  },
  // Per-project gate for transient S3 spool at ingestion edge; ON by default
  // (ADR-022).
  {
    key: "release_trace_blob_offload",
    scope: "PRODUCT",
    defaultValue: true,
    description:
      "Routes over-threshold OTLP spans through a transient S3 spool at the ingestion edge so oversized attribute values reach the trace intact (ADR-022). On by default; switch it off fleet-wide or per project to keep spans inline, where the 256 KB per-value cap applies. Deployments with no reachable object storage keep ingesting either way: the edge falls back inline and the same 256 KB cap applies.",
  },
  // Externalizes inline media to stored-objects store at ingestion edge;
  // currently opt-in (ADR pending).
  {
    key: "release_trace_media_extraction",
    scope: "PRODUCT",
    defaultValue: false,
    description:
      "Externalizes inline media (audio, images, files) from span content into the content-addressed stored-objects store at the ingestion edge, replacing base64 payloads with /api/files references. Off = media stays inline through the pipeline as before. Note: stored media is not yet covered by retention deletion; enable knowingly.",
  },
  // Allowlist for born-finalized entrance (ADR-116 §3); couples sign-up to
  // engine availability, so enable per organization knowingly.
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
    // On by default (ADR-038 Decision 7); pinned with auth-cli device-login
    // fallback (governanceGaDefaults.unit.test.ts
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
      "Reveals Costs and the Platform preview pages (Insights, Analytics, Signals & Alerts) and their sidebar items. Composed ON TOP of release_ui_ai_governance_enabled: the section flag off still hides everything. Default off. Costs renders billed/gateway amounts and seat counts; the unfinished Billed address stays unavailable. Enable per organization via the operator store; for local dev use FEATURE_FLAG_FORCE_ENABLE=release_ui_governance_billed_cost_enabled. Specs: specs/ai-gateway/governance/governance-home-routing.feature, specs/governance/governance-cost-screen.feature.",
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
  // SYSTEM on purpose despite being a product surface: the Langy rollout is
  // decided solely by the internal flag store — never an env var
  // (envOverridable: false) — so /ops/feature-flags is the one lever.
  {
    key: "release_langy_enabled",
    scope: "SYSTEM",
    defaultValue: false,
    envOverridable: false,
    family: "Langy",
    description:
      "Opens the Langy in-product assistant, with no staff or identity bypass. Off by default and managed only through the operator store; environment overrides are deliberately disabled.",
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
      "Shows the Langy teaser banner to people who do not have Langy. It never grants access; target its audience through operator rules.",
  },
  {
    key: "release_custom_chart_playground",
    scope: "SYSTEM",
    defaultValue: false,
    envOverridable: false,
    family: "Custom Chart Playground",
    description:
      "Opens the custom-chart-playground page, its playground-widget REST routes, and the Langy skill that drives them, outside local development — otherwise all three are dev-only unconditionally. Default off, so the surface stays dev-only until someone is explicitly opted in. Managed only from the internal flag store: toggle it, or add per-project/per-org targeting rules, via /ops/feature-flags. For local dev use FEATURE_FLAG_FORCE_ENABLE=release_custom_chart_playground.",
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
    defaultValue: true,
    description:
      "Unlocks Agent Testing, the v2 interface for simulations (specs under specs/features/agent-testing/): one page with the scenarios and the results in tabs, test suites as folders of scenarios, run notes, scenario versions, and a wider run drawer that puts the results beside the conversation. Flag off leaves the Simulations pages and menu group exactly as they were; the flag only decides which interface renders, and the backend additions it uses are unflagged. Default on, so a self-hosted installation reads Agent Testing with no rule; a rule keeps a project or an organization on the Simulations pages. Every simulations address redirects to Agent Testing while the flag is on.",
  },
  {
    // D12 (ADR-117). Named `join_requests` rather than the usual
    // `release_...` prefix so its auto-derived env override is exactly
    // `JOIN_REQUESTS`, which is the operator lever the epic names and the
    // one thing rollback consists of.
    key: "join_requests",
    scope: "PRODUCT",
    defaultValue: false,
    description:
      "Lets somebody with a verified company address find the organization their colleagues are already in and ask to join it, and lets an administrator turn that into automatic joining for a domain they name (spec: specs/identity/join-requests.feature, join-matching-and-privacy.feature, domain-auto-join.feature, join-before-create.feature). Off = the sign-up interstitial never renders, the members area shows no requests section, the lookup answers nothing to everyone, and no join command is ever dispatched. This is the whole of the rollback. Force-enable in dev via FEATURE_FLAG_FORCE_ENABLE=join_requests, or set JOIN_REQUESTS=1 on a deployment.",
  },
  {
    key: "release_webhook_automations",
    scope: "PRODUCT",
    defaultValue: false,
    description:
      "Offers the Webhook (generic HTTP request) delivery channel for automations (ADR-040). Gates the delivery-picker card, the save route accepting SEND_WEBHOOK, and the test-fire path. Force-enable in dev via FEATURE_FLAG_FORCE_ENABLE=release_webhook_automations.",
  },
  {
    key: "experiment_onboarding_langy_guided",
    scope: "PRODUCT",
    defaultValue: false,
    family: "Langy",
    description:
      'The guided onboarding: after sign-up Langy takes over the screen, asks what to set up, connects a provider, tours the product and drives the real setup from its panel (spec: specs/features/onboarding/guided-onboarding-variant.feature). Off = the classic wizard, unchanged. For the A/B test add a rule { percentageRollout: 50 } at /ops/feature-flags: the split is a stable hash of the user id, so one user sees the same variant on every read. The resolved variant is recorded on the organization at creation. To QA it in production without touching real users, add a rule { emailDomain: "yourcompany.com" } above the percentage: every fresh account at that domain lands in the guided flow. Force-enable in dev via FEATURE_FLAG_FORCE_ENABLE=experiment_onboarding_langy_guided or ?ff_experiment_onboarding_langy_guided=on in the browser.',
  },
] as const satisfies readonly FeatureFlagDefinition[];

export const FEATURE_FLAG_FAMILIES: readonly FeatureFlagFamily[] = [
  // Event-sourcing kill switches, generated as
  // `es-<aggregate>-<componentType>-<componentName>-killswitch`. Default false:
  // absence of a row means "let the component run". The family exists so a
  // generated key resolves SYSTEM without one registry entry per component.
  {
    keyPrefix: "es-",
    keySuffix: "-killswitch",
    scope: "SYSTEM",
    defaultValue: false,
    description:
      "Per-component kill switch for an event-sourcing projection, map projection, command or subscriber. Setting it to true stops that component for the tenants the rules name, cluster-wide.",
    family: "Event sourcing",
  },
];

/**
 * Union of every flag key the application can resolve at runtime. Use it
 * wherever a flag key is accepted so unregistered flags fail the build.
 */
export type RegisteredFeatureFlagKey = (typeof FEATURE_FLAGS)[number]["key"];

/**
 * The generated event-sourcing kill-switch family, as a type: registered as a
 * family, so the key union has to admit the shape the generator produces.
 */
export type EsKillSwitchKey = `es-${string}-${string}-${string}-killswitch`;
export type FeatureFlagKey = RegisteredFeatureFlagKey | EsKillSwitchKey;

const FLAGS_BY_KEY: Map<string, FeatureFlagDefinition> = new Map(
  FEATURE_FLAGS.map((f) => [f.key, f]),
);

/**
 * Resolve a flag key to its registered definition, exact matches before
 * family-prefix matches. Undefined means callers fall through to legacy
 * in-memory evaluation (back-compat for pre-registry flags).
 */
export function pickFlagDefinition(key: string): FeatureFlagDefinition | undefined {
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
