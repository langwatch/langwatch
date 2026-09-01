/**
 * The flags a signed-in browser may resolve.
 *
 * The app's evaluation transport validates its input against this list, so a
 * flag absent here cannot be queried from the browser at all. Every key here
 * is also a registered flag, so the browser can only ask about flags the
 * registry actually defines.
 *
 * Naming: `{type}_{area}_{feature}_{descriptor}`, where type is one of
 * release, experiment, permission or ops, and area is one of ui, api, es or
 * worker. Targeting is per project or organization and is configured as
 * operator-store rules, never in the key.
 *
 * @see ../../adrs/001-feature-flag-service-boundary.md
 */

import { z } from "zod";

export const FRONTEND_FEATURE_FLAGS = [
  "release_ui_ai_gateway_menu_enabled",
  "release_ui_beta_annotations_trained_enabled",
  // Product-scoped navigation shells (product-switcher / icon-rail) plus
  // the avatar-menu mode picker. The flag unlocks the picker; the
  // per-device mode in localStorage decides which shell renders. Flag off
  // or mode legacy = the current chrome, unchanged. See
  // specs/navigation/navigation-modes.feature and useNavigationMode.
  "release_ui_navigation_v2_enabled",
  // Governance: gates the personal-keys / admin oversight /
  // RoutingPolicy / IngestionSource UI surfaces. On by default
  // (ADR-038 Decision 7); SaaS rollout and per-org kill switches are
  // operator-store rules. Distinct from `release_ui_ai_gateway_menu_enabled`
  // because the gateway product ships on its own flag.
  // Force off in dev: `RELEASE_UI_AI_GOVERNANCE_ENABLED=0`.
  "release_ui_ai_governance_enabled",
  // Composes ON TOP of `release_ui_ai_governance_enabled` to reveal the
  // governance Costs and Billed pages and their two sidebar items. Off by
  // default; the section flag being off still hides both.
  "release_ui_governance_billed_cost_enabled",
  "release_langy_enabled",
  "release_langy_promo_enabled",
  // Gates the Optimize this prompt menu item alongside the UI-action channel
  // it hands off to; the server-side dispatch checks the same flag.
  "release_langy_ui_actions",
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
  // Bradley-Terry leaderboard chart on the experiments-v3 results page
  // (issue #5103, specs/experiments/comparison-leaderboard.feature). Off by
  // default — power-user surface, additive to the existing win-rate chart.
  "release_ui_comparison_leaderboard_enabled",
  // The Agent Testing v2 interface: one page with Scenarios and Results
  // tabs, test suites as folders, run notes, scenario versions, and the
  // wide run drawer (specs/features/agent-testing/). Off by default and
  // purely additive: the current Simulations pages and menu group are
  // untouched while it is off, and the backend it calls is unflagged.
  "release_ui_agent_testing_v2_enabled",
] as const;

/** A key the browser may ask about. */
export type FrontendFeatureFlag = (typeof FRONTEND_FEATURE_FLAGS)[number];

export const frontendFeatureFlagSchema = z.enum(FRONTEND_FEATURE_FLAGS);

/** Every browser-visible flag, present exactly once. */
export const frontendFeatureFlagMapSchema = z.record(frontendFeatureFlagSchema, z.boolean());
