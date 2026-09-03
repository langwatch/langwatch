/**
 * One browser-visible release flag, resolved for the signed-in reader.
 *
 * `~/hooks/useFeatureFlag` read the application's flag query. The read is one
 * procedure and this family already declares its own procedure map, so it is
 * stated here against this family's transport rather than reached for across
 * a package whose transport is not this one's.
 *
 * React Query deliberately caches longer than the server's kill-switch cache,
 * so a flag mounted on two screens costs one round trip.
 */

import { type FeatureFlagTargetId, NOT_TARGETED } from "@langwatch/feature-flag-contract";

import { api } from "./scenario-api";

/** Five minutes: the service caches operator rows for five seconds anyway. */
export const CLIENT_FLAG_STALE_TIME_MS = 5 * 60_000;

interface UseFeatureFlagOptions {
  /** The project this read is about, or `NOT_TARGETED`. */
  projectId: FeatureFlagTargetId;
  /** The organization this read is about, or `NOT_TARGETED`. */
  organizationId: FeatureFlagTargetId;
  /** False while an id the read targets is still arriving. Defaults to true. */
  enabled?: boolean;
}

interface UseFeatureFlagResult {
  /** Fail-closed: false while the answer is still in flight. */
  enabled: boolean;
  isLoading: boolean;
}

/**
 * JSON carries no `undefined`, so both "no such scope" and "not known yet"
 * travel as `null`. The wire field itself stays required, so the request
 * always states what it targets.
 */
function toWireTargetId(id: FeatureFlagTargetId): string | null {
  return id === void 0 || id === NOT_TARGETED ? null : id;
}

export function useFeatureFlag(flag: string, options: UseFeatureFlagOptions): UseFeatureFlagResult {
  const queryEnabled = options.enabled ?? true;

  const { data, isLoading } = api.featureFlag.isEnabled.useQuery(
    {
      flag,
      projectId: toWireTargetId(options.projectId),
      organizationId: toWireTargetId(options.organizationId),
    },
    {
      staleTime: CLIENT_FLAG_STALE_TIME_MS,
      refetchOnWindowFocus: false,
      enabled: queryEnabled,
      trpc: { context: { skipBatch: true } },
    },
  );

  return {
    enabled: data?.enabled ?? false,
    isLoading: queryEnabled ? isLoading : false,
  };
}
