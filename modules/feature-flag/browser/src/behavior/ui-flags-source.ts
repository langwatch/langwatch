/**
 * The `UiFlags` host service: the current scope's flags from one `featureFlag.resolve`
 * read, asked once the reader and scope have settled; this browser's `?ff_` answers win.
 */

import type { UiActiveScope, UiHostServiceInput } from "@langwatch/browser-host/capabilities";
import type { UiFlags } from "@langwatch/browser-host/feature-flag";
import {
  CLIENT_FLAG_STALE_TIME_MS,
  featureFlagClient,
  useFeatureFlagOverrides,
} from "@langwatch/feature-flag-client";
import type { AuthenticatedFeatureFlagTargetInput } from "@langwatch/feature-flag-contract";

/** The narrowest target the scope names, so a project rule matches on a project page. */
export function currentScopeTarget({
  organizationId,
  projectId,
}: UiActiveScope): AuthenticatedFeatureFlagTargetInput {
  if (organizationId && projectId) return { kind: "project", projectId, organizationId };
  if (organizationId) return { kind: "organization", organizationId };
  return { kind: "user" };
}

export default function useUiFlagsSource({ session, scope }: UiHostServiceInput): UiFlags {
  const overrides = useFeatureFlagOverrides();
  const settled = session.currentUser() !== null && session.snapshot().scope.status !== "loading";
  const { data } = featureFlagClient.featureFlag.resolve.useQuery(
    { target: currentScopeTarget(scope.activeScope()) },
    { enabled: settled, staleTime: CLIENT_FLAG_STALE_TIME_MS, refetchOnWindowFocus: false },
  );
  const answers = new Map(Object.entries({ ...data?.flags, ...overrides }));
  return { flag: ({ name }) => answers.get(name) };
}
