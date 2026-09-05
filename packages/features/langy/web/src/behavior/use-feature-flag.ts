/**
 * A release flag, tri-state, answered by the host.
 */

import { useLangyHost } from "../model/langy-host";

export type UseFeatureFlagResult = {
  /** Fail-closed, the way every call site reads it. */
  enabled: boolean;
  /** The tri-state, for a caller choosing between whole compositions. */
  data: boolean | undefined;
  isLoading: boolean;
};

/**
 * `options` is accepted and ignored.
 */
export function useFeatureFlag(
  flag: string,
  _options?: { projectId?: string; organizationId?: string; enabled?: boolean },
): UseFeatureFlagResult {
  const host = useLangyHost();
  const value = host.featureFlag(flag);
  return { enabled: value === true, data: value, isLoading: value === void 0 };
}
