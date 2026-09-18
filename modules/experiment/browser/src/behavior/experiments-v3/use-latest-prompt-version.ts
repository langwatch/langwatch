import { useOrganizationTeamProject } from "@langwatch/browser-host/use-organization-team-project";
import { api } from "@langwatch/browser-trpc/workflow-api";
import { useRef } from "react";

type UseLatestPromptVersionResult = {
  /** The current version number */
  currentVersion: number | undefined;
  /** The latest version number from the database */
  latestVersion: number | undefined;
  /** Whether the current version is behind the latest */
  isOutdated: boolean;
  /** Whether we're still loading the latest version */
  isLoading: boolean;
};

type UseLatestPromptVersionOptions = {
  /** The config ID to check */
  configId: string | undefined;
  /** The current version number */
  currentVersion: number | undefined;
};

/**
 * Detects version drift for the target header's `VersionBadge`. A peer of
 * the prompt module's own drift check, both calling the same
 * contract-derived `prompts.getByIdOrHandle` query directly.
 */
export const useLatestPromptVersion = ({
  configId,
  currentVersion,
}: UseLatestPromptVersionOptions): UseLatestPromptVersionResult => {
  const { project } = useOrganizationTeamProject();

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
      staleTime: 0,
      refetchOnWindowFocus: true,
    },
  );

  const latestVersion = latestPrompt?.version;

  let isOutdated: boolean;
  if (isLoading) {
    isOutdated = false;
  } else if (isFetching) {
    isOutdated = lastOutdatedRef.current;
  } else {
    isOutdated =
      latestVersion !== undefined && currentVersion !== undefined && latestVersion > currentVersion;
    lastOutdatedRef.current = isOutdated;
  }

  return {
    currentVersion,
    latestVersion,
    isOutdated,
    isLoading,
  };
};
