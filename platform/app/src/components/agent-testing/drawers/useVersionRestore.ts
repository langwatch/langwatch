/**
 * Restoring an older version of a test case: the confirmation the reader gives
 * first, and the write that follows.
 *
 * @see specs/scenarios/scenario-version-restore.feature
 */

import { useState } from "react";
import { toaster } from "~/components/ui/toaster";
import { showErrorToast } from "~/features/errors";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { api } from "~/utils/api";

export type VersionRestore = ReturnType<typeof useVersionRestore>;

export function useVersionRestore({ scenarioId }: { scenarioId: string }) {
  const { project } = useOrganizationTeamProject();
  const utils = api.useUtils();
  const [confirmingVersion, setConfirmingVersion] = useState<number | null>(
    null,
  );

  const mutation = api.scenarios.restoreVersion.useMutation({
    onSuccess: (_result, variables) => {
      void utils.scenarios.listVersions.invalidate();
      void utils.scenarios.getAll.invalidate();
      void utils.scenarios.getById.invalidate();
      void utils.scenarios.getByIdIncludingArchived.invalidate();
      toaster.create({
        title: `Restored version ${variables.version}`,
        type: "success",
      });
    },
    onError: (error) =>
      showErrorToast({ error, fallbackTitle: "Couldn't restore this version" }),
    onSettled: () => setConfirmingVersion(null),
  });

  return {
    confirmingVersion,
    ask: (version: number) => setConfirmingVersion(version),
    cancel: () => setConfirmingVersion(null),
    confirm: (version: number) =>
      mutation.mutate({
        projectId: project?.id ?? "",
        scenarioId,
        version,
      }),
    isRestoringVersion: (version: number) =>
      mutation.isPending && mutation.variables?.version === version,
  };
}
