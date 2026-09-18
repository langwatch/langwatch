import { useRef } from "react";

import { promptApi } from "./prompt-api.ts";
import { usePromptProject } from "./use-prompt-project.ts";

type UseLatestPromptVersionResult = {
  /** The current version number */
  currentVersion: number | undefined;
  /** The latest version number from the database */
  latestVersion: number | undefined;
  /** Whether the current version is behind the latest */
  isOutdated: boolean;
  /** Whether we're still loading the latest version */
  isLoading: boolean;
  /** The next version number (latest + 1) for saving */
  nextVersion: number | undefined;
};

type UseLatestPromptVersionOptions = {
  /** The config ID to check */
  configId: string | undefined;
  /** The current version number */
  currentVersion: number | undefined;
  /**
   * Whether this instance re-fetches on window focus (default `true`). Pass
   * `false` for N-mounted instances (tab, column) - that storm was #5585.
   * Gated instances are save-driven, so other sessions need a reload.
   */
  isLiveRefetchEnabled?: boolean;
};

/**
 * Detects version drift between the current version and the database, for
 * SavePromptButton's "Update to vX" and VersionBadge's outdated warning.
 * React Query dedupes by configId, so multiple callers cost one request.
 */
export const useLatestPromptVersion = ({
  configId,
  currentVersion,
  isLiveRefetchEnabled = true,
}: UseLatestPromptVersionOptions): UseLatestPromptVersionResult => {
  const { project } = usePromptProject();

  // Keep track of the last known outdated state to prevent flicker during refetch
  const lastOutdatedRef = useRef<boolean>(false);

  const {
    data: latestPrompt,
    isLoading,
    isFetching,
  } = promptApi.prompts.getByIdOrHandle.useQuery(
    {
      idOrHandle: configId ?? "",
      projectId: project?.id ?? "",
    },
    {
      enabled: !!configId && !!project?.id,
      // Live by default so a version updated elsewhere stays observable
      // without reload; N-mounted callers opt out via `isLiveRefetchEnabled:
      // false`. True cross-session liveness would need a version-number
      // endpoint (#5585).
      staleTime: isLiveRefetchEnabled ? 0 : 30_000,
      refetchOnWindowFocus: isLiveRefetchEnabled,
    },
  );

  const latestVersion = latestPrompt?.version;

  // Calculate current outdated state, but only when we have fresh data
  // During refetch (isFetching && !isLoading), keep the previous value to prevent flicker
  let isOutdated: boolean;
  if (isLoading) {
    // Initial load - not outdated yet
    isOutdated = false;
  } else if (isFetching) {
    // Refetch in flight (window focus when live, cache invalidation after a
    // save otherwise) - keep previous value to prevent flicker
    isOutdated = lastOutdatedRef.current;
  } else {
    // Fresh data available
    isOutdated =
      latestVersion !== undefined && currentVersion !== undefined && latestVersion > currentVersion;
    lastOutdatedRef.current = isOutdated;
  }

  return {
    currentVersion,
    latestVersion,
    isOutdated,
    isLoading,
    nextVersion: latestVersion !== undefined ? latestVersion + 1 : undefined,
  };
};
