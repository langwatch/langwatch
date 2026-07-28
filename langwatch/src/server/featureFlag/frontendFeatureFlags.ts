/**
 * Feature flags exposed to the frontend via tRPC.
 *
 * This constant defines which flags can be checked from the frontend using
 * the `useFeatureFlag` hook. Only flags listed here can be queried via the
 * `featureFlag.isEnabled` tRPC endpoint.
 *
 * ## Naming Convention
 *
 * Pattern: `{type}_{area}_{feature}_{descriptor}`
 *
 * ### Type (what kind of flag):
 * - `release` - new feature rollout
 * - `experiment` - A/B test
 * - `permission` - access control
 * - `ops` - operational/kill switch
 *
 * ### Area (part of the system):
 * - `ui` - frontend/UI features
 * - `api` - API endpoints
 * - `es` - event sourcing
 * - `worker` - background workers
 *
 * ### Feature: the feature area (e.g., `simulations`, `prompts`, `traces`)
 *
 * ### Descriptor: specific target + state (e.g., `menu_enabled`, `endpoint_access`)
 *
 * ## Examples
 * - `permission_api_prompts_v2_access` - API access control
 * - `ops_es_trace_processing_killswitch` - operational kill switch
 * - `experiment_ui_dashboard_new_layout` - A/B experiment
 *
 * ## Optional Suffixes
 * - `_temp` - temporary flag, clean up after rollout
 * - `_perma` - permanent flag, long-lived
 *
 * ## Targeting
 *
 * Flags can target users, projects, or organizations via PostHog personProperties.
 * Configure targeting in PostHog release conditions, not in the flag name.
 * Pass `projectId` or `organizationId` to `useFeatureFlag` for targeted evaluation.
 *
 * ## Adding New Flags
 *
 * 1. Create the flag in PostHog with your desired release conditions
 * 2. Add the flag key to this array
 * 3. Use `useFeatureFlag("your_flag_key")` in components
 *
 * @see dev/docs/adr/005-feature-flags.md for architecture decisions
 * @see useFeatureFlag for frontend usage
 */
export const FRONTEND_FEATURE_FLAGS = [
  "release_ui_ai_gateway_menu_enabled",
  // Governance: gates the personal-keys / admin oversight /
  // RoutingPolicy / IngestionSource UI surfaces. On by default
  // (ADR-038 Decision 7); SaaS rollout and per-org kill switches live
  // in PostHog. Distinct from `release_ui_ai_gateway_menu_enabled`
  // because the gateway product ships on its own flag.
  // Force off in dev: `RELEASE_UI_AI_GOVERNANCE_ENABLED=0`.
  "release_ui_ai_governance_enabled",
  "release_langy_enabled",
  "release_langy_promo_enabled",
  // The Langy home composition (the lit block leads, with a real composer in
  // it). Rolls out on its own schedule ON TOP of `release_langy_enabled`:
  // having Langy is necessary but not sufficient, so the panel can ship to a
  // project long before its home page changes shape. Outranked by
  // `release_ui_home_signal_focused_enabled`. See useHomeComposition.
  // The signal-focused home composition (briefing sheet leads). Decides
  // the homepage's layout ONLY — Langy access separately gates the
  // sheet's hand-to-Langy affordances. See useShowSignalFocusedHome.
  "release_ui_home_signal_focused_enabled",
  // Langy's minimised state as an edge peek of the panel itself (spec:
  // specs/langy/langy-peek-dock.feature). Flag off = the classic corner
  // launcher orb. Swaps only the CLOSED-state affordance; opening, the
  // panel and Cmd/Ctrl+I are identical either way.
  "release_ui_langy_peek_dock_enabled",
  "release_webhook_automations",
  // Pins the Ops section into the main sidebar for a user who already has ops
  // access, so it shows on every route instead of only under /ops. Deliberately
  // NOT a PostHog flag — it resolves false server-side (unknown flag) and is
  // meant to be forced On locally from the hidden Feature Flags (Dev) drawer,
  // persisting in that browser via the local override. It never widens who can
  // see ops: the sidebar still gates on ops access, so a non-ops user forcing
  // it On sees nothing. Env `SHOW_OPS_IN_MAIN_SIDEBAR` remains the fleet-wide
  // allowlist; this is the per-browser convenience that needs no server change.
  "ops_ui_ops_menu_pinned",
] as const;

/**
 * Type representing a valid frontend feature flag key.
 * Use this type for type-safe flag references.
 */
export type FrontendFeatureFlag = (typeof FRONTEND_FEATURE_FLAGS)[number];
