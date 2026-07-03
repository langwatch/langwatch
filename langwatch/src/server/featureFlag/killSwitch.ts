import { KILL_SWITCH_CACHE_TTL_MS } from "./constants";
import type { FeatureFlagKey } from "./registry";
import type { FeatureFlagServiceInterface } from "./types";

/**
 * Two-tier (global + per-project) backend kill switch, shared by the per-span
 * enrichment services (token estimation, block classification) that each gate
 * their hot path on the same shape. Both lookups widen the cache window past the
 * 5s frontend-flag default via KILL_SWITCH_CACHE_TTL_MS, since this runs per span
 * and a cache miss is one billable /flags request.
 *
 * No featureFlagService (e.g. unit tests) → not disabled, so the feature is ON
 * by default and the switch is a deliberate opt-out.
 */
export async function isDisabledByKillSwitch({
  featureFlagService,
  globalKey,
  projectKey,
  tenantId,
}: {
  featureFlagService: FeatureFlagServiceInterface | undefined;
  /** Global kill switch — disables for all projects when on. */
  globalKey: FeatureFlagKey;
  /** Per-project kill switch — disables only the given tenant when on. */
  projectKey: FeatureFlagKey;
  tenantId?: string;
}): Promise<boolean> {
  if (!featureFlagService) return false;

  const globalDisabled = await featureFlagService.isEnabled(globalKey, {
    distinctId: "global",
    defaultValue: false,
    cacheTtlMs: KILL_SWITCH_CACHE_TTL_MS,
  });
  if (globalDisabled) return true;

  if (tenantId) {
    const projectDisabled = await featureFlagService.isEnabled(projectKey, {
      distinctId: tenantId,
      defaultValue: false,
      projectId: tenantId,
      cacheTtlMs: KILL_SWITCH_CACHE_TTL_MS,
    });
    if (projectDisabled) return true;
  }

  return false;
}
