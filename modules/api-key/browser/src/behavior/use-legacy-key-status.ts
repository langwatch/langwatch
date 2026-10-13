import { apiKeyApi } from "./api-key-api.ts";

/**
 * Whether the project still has its legacy key. The server answers only those with
 * `project:manage`, so a reader without it is never asked for the status at all.
 */
export function useLegacyKeyPresent({
  projectId,
  canManageProject,
}: {
  projectId: string | undefined;
  canManageProject: boolean;
}): boolean {
  const status = apiKeyApi.project.getLegacyKeyStatus.useQuery(
    { projectId: projectId ?? "" },
    { enabled: !!projectId && canManageProject, retry: false },
  );
  return status.data?.present === true;
}
