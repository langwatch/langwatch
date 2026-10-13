/**
 * The `UiFlags` host service: the current scope's flags from one `featureFlag.resolve`
 * read, asked once the reader and scope have settled; this browser's `?ff_` answers win.
 */

import type { UiActiveScope, UiHostServiceInput } from "@langwatch/browser-host/capabilities";
import type { UiFlags } from "@langwatch/browser-host/feature-flag";
import {
  CLIENT_FLAG_STALE_TIME_MS,
  featureFlagClient,
  type FeatureFlagOverrides,
  useFeatureFlagOverrides,
} from "@langwatch/feature-flag-client";
import type {
  AuthenticatedFeatureFlagTargetInput,
  FrontendFeatureFlagMap,
} from "@langwatch/feature-flag-contract";

/** The narrowest target the scope names, so a project rule matches on a project page. */
export function currentScopeTarget({
  organizationId,
  projectId,
}: UiActiveScope): AuthenticatedFeatureFlagTargetInput {
  if (organizationId && projectId) return { kind: "project", projectId, organizationId };
  if (organizationId) return { kind: "organization", organizationId };
  return { kind: "user" };
}

/**
 * The answers a reader sees: overrides first, then the read. A failed read
 * answers off rather than "not yet", or a refused reader waits forever.
 */
export function uiFlagsFrom({
  flags,
  overrides,
  isFailed,
}: {
  flags: FrontendFeatureFlagMap | undefined;
  overrides: FeatureFlagOverrides;
  isFailed: boolean;
}): UiFlags {
  const answers = new Map(Object.entries({ ...flags, ...overrides }));
  return { flag: ({ name }) => answers.get(name) ?? (isFailed ? false : void 0) };
}

export default function useUiFlagsSource({ session, scope }: UiHostServiceInput): UiFlags {
  const overrides = useFeatureFlagOverrides();
  const settled = session.currentUser() !== null && session.snapshot().scope.status !== "loading";
  const { data, isError } = featureFlagClient.featureFlag.resolve.useQuery(
    { target: currentScopeTarget(scope.activeScope()) },
    { enabled: settled, staleTime: CLIENT_FLAG_STALE_TIME_MS, refetchOnWindowFocus: false },
  );
  return uiFlagsFrom({ flags: data?.flags, overrides, isFailed: isError });
}
