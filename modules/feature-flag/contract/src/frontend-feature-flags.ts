/**
 * Flags a signed-in browser may resolve; validated against FEATURE_FLAGS
 * registry.
 */

import { z } from "zod";

export const FRONTEND_FEATURE_FLAGS = [
  // The Analytics v2 page (nine standard charts as dashboard widgets over
  // LangWatchQL). Off by default; the page also gates on LangWatchQL being
  // available for the project.
  "release_analytics_v2",
  "release_ui_ai_gateway_menu_enabled",
  "release_ui_beta_annotations_trained_enabled",
  "release_voice_agents_enabled",
  // Governance: gates personal-keys / admin oversight / RoutingPolicy /
  // IngestionSource UI. On by default (ADR-038 Decision 7); SaaS rollout
  // and per-org kill switches are operator-store rules. Distinct from
  // `release_ui_ai_gateway_menu_enabled` (its own flag).
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
  // The signal-focused home composition (briefing sheet leads), outranking
  // the default Langy home composition (lit block) that otherwise rolls out
  // ON TOP of `release_langy_enabled`. Decides layout ONLY — Langy access
  // separately gates the sheet's hand-to-Langy affordances.
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
  // The custom-chart-playground page and its widget routes outside local
  // development; the full registry documents the rollout story.
  "release_custom_chart_playground",
  // The guided onboarding variant, read on the welcome flow with the user's
  // id, which the percentage rollout buckets on (guided-onboarding-variant.feature).
  "experiment_onboarding_langy_guided",
] as const;

/** A key the browser may ask about. */
export type FrontendFeatureFlag = (typeof FRONTEND_FEATURE_FLAGS)[number];

export const frontendFeatureFlagSchema = z.enum(FRONTEND_FEATURE_FLAGS);

/** Every browser-visible flag, present exactly once. */
export const frontendFeatureFlagMapSchema = z.record(frontendFeatureFlagSchema, z.boolean());
