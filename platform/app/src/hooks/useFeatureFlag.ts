import type { FrontendFeatureFlag } from "../server/featureFlag/frontendFeatureFlags";
import {
  type FeatureFlagTargetId,
  NOT_TARGETED,
} from "../server/featureFlag/targeting";
import { api } from "../utils/api";
import { useFeatureFlagOverrides } from "./useFeatureFlagOverrides";

// Client-side React Query staleTime — independent of the server-side
// PostHog cache TTL. The server already short-circuits with its own 5s
// cache; making the client refetch every 5s just thrashes tRPC for no
// freshness gain. 5 min keeps kill-switch propagation reasonable for an
// active session while eliminating the per-drawer-open / per-poll-tick
// re-fetch storm we observed on /traces.
export const CLIENT_FLAG_STALE_TIME_MS = 5 * 60_000;

/**
 * Targeting identity and query control for one flag read.
 *
 * `projectId` and `organizationId` are both required. A targeting rule that
 * names a scope the read left out can never match, so an omitted field turns
 * a per-organization or per-project rollout into a silent no-op. Requiring
 * both makes a forgotten field a compile error.
 *
 * Each id takes one of three values:
 * - a real id, so rules that name it can match.
 * - `NOT_TARGETED`, when the surface has no such id at all. Rules that name
 *   this scope never match, which is the point of saying it out loud.
 * - `undefined`, when the id is still loading. Write it out and pair it with
 *   `enabled: false`, so the read waits for the id instead of resolving
 *   against an empty context.
 */
interface UseFeatureFlagOptions {
  /** The project this read is about, or `NOT_TARGETED`. */
  projectId: FeatureFlagTargetId;
  /** The organization this read is about, or `NOT_TARGETED`. */
  organizationId: FeatureFlagTargetId;
  /**
   * Set to false to disable the query (e.g., while waiting for projectId).
   * Defaults to true.
   */
  enabled?: boolean;
}

/**
 * JSON carries no `undefined`, so both "no such scope" and "not known yet"
 * travel as `null`. The wire field itself stays required, so the request
 * always states what it targets.
 */
function toWireTargetId(id: FeatureFlagTargetId): string | null {
  return id === undefined || id === NOT_TARGETED ? null : id;
}

interface UseFeatureFlagResult {
  /** Whether the feature flag is enabled. Returns false while loading. */
  enabled: boolean;
  /** Whether the flag check is in progress. */
  isLoading: boolean;
}

/**
 * React hook to check if a feature flag is enabled for the current user.
 *
 * Makes a tRPC call that resolves the flag server-side, with the project and
 * the organization the read is about so targeting rules can match.
 *
 * ## Usage
 *
 * ```tsx
 * // The usual case: both ids are known, both are stated.
 * const { project, organization } = useOrganizationTeamProject();
 * const { enabled } = useFeatureFlag("release_ui_ai_gateway_menu_enabled", {
 *   projectId: project?.id,
 *   organizationId: organization?.id,
 *   enabled: !!project?.id && !!organization?.id,
 * });
 *
 * // A surface with no project of its own opts that scope out by name.
 * const { enabled } = useFeatureFlag("release_ui_ai_gateway_menu_enabled", {
 *   projectId: NOT_TARGETED,
 *   organizationId: organization?.id,
 *   enabled: !!organization?.id,
 * });
 * ```
 *
 * ## Caching
 *
 * Server-side (Redis/memory) cache TTL is `FEATURE_FLAG_CACHE_TTL_MS` (5s) so
 * kill switches propagate to the backend quickly. The client-side React Query
 * staleTime is longer (5 min) — refetching every 5s on every consumer thrashed
 * tRPC during page interactions without ever beating the server cache.
 *
 * @param flag - The feature flag key (must be in FRONTEND_FEATURE_FLAGS)
 * @param options - Optional targeting and query configuration
 * @returns Object with `enabled` (boolean) and `isLoading` (boolean)
 *
 * @see dev/docs/adr/005-feature-flags.md for architecture decisions
 * @see FRONTEND_FEATURE_FLAGS for available flags
 */
export function useFeatureFlag(
  flag: FrontendFeatureFlag,
  options: UseFeatureFlagOptions,
): UseFeatureFlagResult {
  const queryEnabled = options.enabled ?? true;

  const overrides = useFeatureFlagOverrides();
  const override = overrides[flag];

  const { data, isLoading } = api.featureFlag.isEnabled.useQuery(
    {
      flag,
      projectId: toWireTargetId(options.projectId),
      organizationId: toWireTargetId(options.organizationId),
    },
    {
      staleTime: CLIENT_FLAG_STALE_TIME_MS,
      refetchOnWindowFocus: false,
      // Skip the network call when an override is set — the override wins
      // anyway, and we don't want a refetch storm while toggling in dev.
      enabled: queryEnabled && override === undefined,
      // Flag checks are mounted at app shell (MainMenu, command bar) and fire
      // alongside the page's data queries. Without splitting, an in-flight
      // tracesV2.list (~1s) would block the menu from rendering its links —
      // and the list's perceived latency would absorb the flag round-trip.
      // Run on its own connection.
      trpc: { context: { skipBatch: true } },
    },
  );

  if (override !== undefined) {
    return { enabled: override, isLoading: false };
  }

  return {
    enabled: data?.enabled ?? false,
    isLoading: queryEnabled ? isLoading : false,
  };
}
