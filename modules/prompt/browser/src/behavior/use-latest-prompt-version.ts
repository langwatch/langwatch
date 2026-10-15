import { useRef } from "react";

import { usePromptVersion } from "./use-prompt-version.ts";

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
};

/**
 * Detects version drift between the current version and the database, for
 * SavePromptButton's "Update to vX" and VersionBadge's outdated warning.
 * React Query dedupes by configId, so multiple callers cost one request.
 */
export const useLatestPromptVersion = ({
  configId,
  currentVersion,
}: UseLatestPromptVersionOptions): UseLatestPromptVersionResult => {
  // Keep track of the last known outdated state to prevent flicker during refetch
  const lastOutdatedRef = useRef<boolean>(false);

  const { data: latestPrompt, isLoading, isFetching } = usePromptVersion({ idOrHandle: configId });

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
