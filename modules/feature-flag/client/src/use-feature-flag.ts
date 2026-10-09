/**
 * A flag read for an explicit project or organization, not the current scope;
 * the current scope's flags are `useUiFlags()` from browser-host.
 */

import {
  type FeatureFlagTargetId,
  type FrontendFeatureFlag,
  NOT_TARGETED,
} from "@langwatch/feature-flag-contract";
import type { ReleaseFlagToken } from "@langwatch/module";

import { CLIENT_FLAG_STALE_TIME_MS, featureFlagClient } from "./feature-flag-client.ts";
import { useFeatureFlagOverrides } from "./feature-flag-overrides.ts";

/**
 * Targeting identity for one flag read. `projectId`/`organizationId` are
 * both required: an omitted scope turns a rollout into a silent no-op.
 * Each id is real, `NOT_TARGETED`, or `undefined` (still loading).
 */
type UseFeatureFlagOptions = {
  projectId: FeatureFlagTargetId;
  organizationId: FeatureFlagTargetId;
  /** False holds the read, e.g. while waiting for projectId. Defaults to true. */
  enabled?: boolean;
};

export type UseFeatureFlagResult = {
  /** Whether the flag is on; false while loading. */
  enabled: boolean;
  isLoading: boolean;
};

/** JSON carries no `undefined`, so "no such scope" and "not known yet" both travel as `null`. */
function toWireTargetId(id: FeatureFlagTargetId): string | null {
  return id === undefined || id === NOT_TARGETED ? null : id;
}

/** This browser's `?ff_` answer wins and is never asked of the server. */
export function useFeatureFlag(
  token: ReleaseFlagToken<FrontendFeatureFlag>,
  { projectId, organizationId, enabled = true }: UseFeatureFlagOptions,
): UseFeatureFlagResult {
  const override = useFeatureFlagOverrides()[token.name];
  const queryEnabled = enabled && override === undefined;

  const { data, isLoading } = featureFlagClient.featureFlag.isEnabled.useQuery(
    {
      flag: token.name,
      projectId: toWireTargetId(projectId),
      organizationId: toWireTargetId(organizationId),
    },
    { staleTime: CLIENT_FLAG_STALE_TIME_MS, refetchOnWindowFocus: false, enabled: queryEnabled },
  );

  if (override !== undefined) return { enabled: override, isLoading: false };
  return { enabled: data?.enabled ?? false, isLoading: queryEnabled ? isLoading : false };
}
