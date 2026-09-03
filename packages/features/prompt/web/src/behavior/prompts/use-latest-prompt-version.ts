import { useRef } from "react";
import { useOrganizationTeamProject } from "@langwatch/workflow-web/studio-host/use-organization-team-project";
import { api } from "@langwatch/workflow-web/studio-host/api";

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
   * Whether this instance keeps the latest version live by re-fetching on
   * window focus. Defaults to `true`.
   *
   * Pass `false` where the hook is mounted once per open tab or per table
   * column. N always-mounted instances each re-firing a full-prompt fetch on
   * every window focus was the query storm #5585 fixed. A gated instance is
   * save-driven instead: `useHandleSavePrompt` invalidates this key, so
   * same-app version bumps still move the badge, but another session's new
   * version isn't reflected until the next save or reload.
   *
   * The callers left live are bounded by open *editors*, not by tab count:
   * one prompt editor drawer, and one editor per browser window in Compare
   * mode (a window renders only its active tab's content — the tab panels are
   * `lazyMount unmountOnExit`). So focus costs one refetch per prompt being
   * edited, and the two hooks inside a window share one query key.
   */
  isLiveRefetchEnabled?: boolean;
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
  isLiveRefetchEnabled = true,
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
      // Live by default so "the prompt was updated in another tab/session"
      // stays observable without a reload — that is the whole point of the
      // drift check for the single-instance callers (save button, editor
      // drawer). The N-mounted callers opt out with
      // `isLiveRefetchEnabled: false`, matching the codebase convention for
      // dashboard queries (see useFilterParams). True cross-session liveness
      // for those would need a lightweight version-number endpoint (noted in
      // #5585).
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
