/**
 * The history drawer's reads and writes: the version list, one version's rows, a comparison
 * with the current content, saving and restoring.
 * Spec: modules/dataset/specs/dataset-versioning.feature.
 */

import { datasetClient } from "@langwatch/dataset-client";
import { useCallback } from "react";

type DatasetScope = { projectId: string | undefined; datasetId: string };

/** The dataset's versions, newest first, and whether its layout allows a restore. */
export function useDatasetVersions({ projectId, datasetId }: DatasetScope) {
  return datasetClient.dataset.versions.useQuery(
    { projectId: projectId ?? "", datasetId },
    { enabled: !!projectId && !!datasetId },
  );
}

/** One page of a version's rows. */
export function useDatasetVersionPage({
  projectId,
  datasetId,
  version,
  page,
  limit,
}: DatasetScope & { version: number | undefined; page: number; limit: number }) {
  return datasetClient.dataset.versionPage.useQuery(
    { projectId: projectId ?? "", datasetId, version: version ?? 1, page, limit },
    { enabled: !!projectId && !!datasetId && version !== undefined },
  );
}

/** What changed between a version and the current content. */
export function useDatasetVersionComparison({
  projectId,
  datasetId,
  version,
}: DatasetScope & { version: number | undefined }) {
  return datasetClient.dataset.compareVersion.useQuery(
    { projectId: projectId ?? "", datasetId, version: version ?? 1 },
    { enabled: !!projectId && !!datasetId && version !== undefined },
  );
}

/** Saves the current content as a version, written into the list it joins. */
export function useSaveDatasetVersion({ projectId, datasetId }: DatasetScope) {
  const utils = datasetClient.useUtils();
  const mutation = datasetClient.dataset.saveVersion.useMutation();
  const { mutateAsync } = mutation;

  const save = useCallback(
    async ({ name }: { name?: string }) => {
      if (!projectId) throw new Error("No project is open, so there is no dataset to save.");
      const saved = await mutateAsync({ projectId, datasetId, ...(name ? { name } : {}) });
      utils.dataset.versions.setData({ projectId, datasetId }, (current) =>
        current
          ? {
              ...current,
              versions: [
                { ...saved, authorName: null },
                ...current.versions.filter((item) => item.id !== saved.id),
              ],
            }
          : current,
      );
      return saved;
    },
    [projectId, datasetId, mutateAsync, utils],
  );

  return { save, isSaving: mutation.isPending };
}

/**
 * Writes a version's content back as a new version. The restore's event refreshes the
 * history, the comparison and the dataset's rows through their read hints.
 */
export function useRestoreDatasetVersion({ projectId, datasetId }: DatasetScope) {
  const mutation = datasetClient.dataset.restoreVersion.useMutation();
  const { mutateAsync } = mutation;

  const restore = useCallback(
    async ({ version }: { version: number }) => {
      if (!projectId) throw new Error("No project is open, so there is no dataset to restore.");
      return mutateAsync({ projectId, datasetId, version });
    },
    [projectId, datasetId, mutateAsync],
  );

  return { restore, isRestoring: mutation.isPending };
}

/** The dataset the history is about, for its name in the header. */
export function useHistoryDataset({ projectId, datasetId }: DatasetScope) {
  return datasetClient.dataset.getById.useQuery(
    { projectId: projectId ?? "", datasetId },
    { enabled: !!projectId && !!datasetId },
  );
}
