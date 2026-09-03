/**
 * A release flag, tri-state, answered by the host.
 *
 * `~/hooks/useFeatureFlag` read the application's flag query. The dock reads
 * three flags and each answer is a tri-state on purpose: `undefined` means the
 * answer has not arrived, and a panel that flashed a capability off while it
 * was in flight would be worse than one that waits.
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
 *
 * The application hook took a project and an organization to evaluate a
 * targeting rule against; the host resolves the flag for the scope the reader
 * is already in, which is the same scope every call site here passed. `enabled`
 * gated the round trip, and there is no round trip.
 */
export function useFeatureFlag(
  flag: string,
  _options?: { projectId?: string; organizationId?: string; enabled?: boolean },
): UseFeatureFlagResult {
  const host = useLangyHost();
  const value = host.featureFlag(flag);
  return { enabled: value === true, data: value, isLoading: value === void 0 };
}
