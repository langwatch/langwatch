/**
 * The dataset the reader last added rows to, remembered per browser.
 *
 * Recovered from `platform/app/src/hooks/useLocalStorageSelectedDataSetId.ts`,
 * deleted in `cc91631cd8`. Two things did not travel with it and neither is a
 * loss: `usehooks-ts`, which this package does not depend on and whose whole
 * contribution was a `useState` over one key, and the cross-hook sync that came
 * with it — one component reads this, so there is nobody to sync with.
 *
 * THE READ-BACK IS VALIDATED, which is the part worth keeping. A remembered id
 * outlives the dataset it names: archived, or belonging to a project the reader
 * has since left. Writing one back unchecked leaves the picker pointed at a
 * dataset the project does not have, and the submit that follows fails for a
 * reason the reader cannot see. So a write asks whether the dataset is still
 * there and clears the memory when it is not.
 */

import { createLogger } from "@langwatch/observability";
import { useCallback, useState } from "react";

import { api } from "../ui/sections/trace-api";
import { useOrganizationTeamProject } from "./use-organization-team-project";

const logger = createLogger("useLocalStorageSelectedDataSetId");

const STORAGE_KEY = "selectedDatasetId";

function readStoredDatasetId(): string {
  if (typeof window === "undefined") return "";
  try {
    return window.localStorage.getItem(STORAGE_KEY) ?? "";
  } catch {
    // A browser with site data blocked throws on read. No memory is the same
    // answer as an empty one, and the picker is usable either way.
    return "";
  }
}

function writeStoredDatasetId(datasetId: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, datasetId);
  } catch {
    /* see readStoredDatasetId */
  }
}

export const useLocalStorageSelectedDataSetId = () => {
  const { project } = useOrganizationTeamProject();
  const trpc = api.useUtils();
  const [selectedDataSetId, setSelectedDataSetId] = useState<string>(readStoredDatasetId);

  const clear = useCallback(() => {
    writeStoredDatasetId("");
    setSelectedDataSetId("");
  }, []);

  const handleSetSelectedDataSetId = useCallback(
    async (datasetId: string) => {
      if (datasetId === "") {
        clear();
        return;
      }

      try {
        const dataset = await trpc.dataset.getById.fetch({
          projectId: project?.id ?? "",
          datasetId,
        });

        if (dataset) {
          writeStoredDatasetId(datasetId);
          setSelectedDataSetId(datasetId);
          return;
        }

        logger.warn(
          { datasetId },
          "Tried to set selected dataset to local storage, but it does not exist",
        );
        clear();
      } catch (error) {
        logger.error({ error }, "Error fetching dataset");
        clear();
      }
    },
    [clear, project?.id, trpc],
  );

  return {
    /** The dataset id this browser remembers, or `""` when it remembers none. */
    selectedDataSetId,
    /** Remembers a dataset, having checked the project still has it. */
    setSelectedDataSetId: handleSetSelectedDataSetId,
    /** Forgets whatever was remembered. */
    clear,
  };
};
