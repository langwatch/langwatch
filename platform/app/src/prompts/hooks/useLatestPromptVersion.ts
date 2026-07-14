import { useRef } from "react";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { api } from "~/utils/api";

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
 * Hook to detect version drift between the current version and the database.
 * Used by SavePromptButton to show accurate "Update to vX" and by VersionBadge
 * to show outdated warnings.
 *
 * React-query will dedupe requests with the same configId, so multiple components
 * using this hook won't cause extra backend calls.
 */
export const useLatestPromptVersion = ({
  configId,
  currentVersion,
}: UseLatestPromptVersionOptions): UseLatestPromptVersionResult => {
  const { project } = useOrganizationTeamProject();

  // Keep track of the last known outdated state to prevent flicker during refetch
  const lastOutdatedRef = useRef<boolean>(false);

  const {
    data: latestPrompt,
    isLoading,
    isFetching,
  } = api.prompts.getByIdOrHandle.useQuery(
    {
      idOrHandle: configId ?? "",
      projectId: project?.id ?? "",
    },
    {
      enabled: !!configId && !!project?.id,
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
    // Refetch (e.g., window focus) - keep previous value to prevent flicker
    isOutdated = lastOutdatedRef.current;
  } else {
    // Fresh data available
    isOutdated =
      latestVersion !== undefined &&
      currentVersion !== undefined &&
      latestVersion > currentVersion;
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
