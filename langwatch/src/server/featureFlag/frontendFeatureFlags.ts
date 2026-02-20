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
 * @see docs/adr/005-feature-flags.md for architecture decisions
 * @see useFeatureFlag for frontend usage
 */
export const FRONTEND_FEATURE_FLAGS = [
  "release_ui_suites_enabled",
  "release_ui_sdk_radar_banner_card_enabled",
] as const;

/**
 * Type representing a valid frontend feature flag key.
 * Use this type for type-safe flag references.
 */
export type FrontendFeatureFlag = (typeof FRONTEND_FEATURE_FLAGS)[number];
