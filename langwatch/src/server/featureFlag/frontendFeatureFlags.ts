/**
 * Feature flags exposed to the frontend via session.
 * These are checked in the session callback and added to session.user.enabledFeatures.
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
 * - `release_ui_simulations_menu_enabled` - UI feature rollout
 * - `permission_api_prompts_v2_access` - API access control
 * - `ops_es_trace_processing_killswitch` - operational kill switch
 * - `experiment_ui_dashboard_new_layout` - A/B experiment
 *
 * ## Optional Suffixes
 * - `_temp` - temporary flag, clean up after rollout
 * - `_perma` - permanent flag, long-lived
 *
 * ## Targeting
 * Flags can target users, projects, or organizations via PostHog personProperties.
 * Configure targeting in PostHog release conditions, not in the flag name.
 */
export const FRONTEND_FEATURE_FLAGS = ["release_ui_simulations_menu_enabled"] as const;
export type FrontendFeatureFlag = (typeof FRONTEND_FEATURE_FLAGS)[number];
