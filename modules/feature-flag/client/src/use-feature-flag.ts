/**
 * A flag read for an explicit project or organization, not the current scope;
 * the current scope's flags are `useUiFlags()` from browser-host.
 */

import { type ContractApiMap, createModuleApi, type ModuleApi } from "@langwatch/api/web";
import {
  type FeatureFlagTargetId,
  type FrontendFeatureFlag,
  type featureFlagTrpc,
  NOT_TARGETED,
} from "@langwatch/feature-flag-contract";
import type { ReleaseFlagToken } from "@langwatch/module";

import { useFeatureFlagOverrides } from "./feature-flag-overrides.ts";

type FeatureFlagApiMap = ContractApiMap<typeof featureFlagTrpc>;

/** The hooks feature flags' own contract generates. */
export const featureFlagClient: ModuleApi<FeatureFlagApiMap> = createModuleApi<FeatureFlagApiMap>();

// The service caches operator rows for five seconds. Refetching every mounted
// read at that cadence adds traffic without making a decision fresher, so the
// browser keeps a resolved value for five minutes.
export const CLIENT_FLAG_STALE_TIME_MS = 5 * 60_000;

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
