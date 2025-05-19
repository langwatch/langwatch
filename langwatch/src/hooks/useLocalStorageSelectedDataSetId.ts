import { useLocalStorage } from "usehooks-ts";
import { api } from "~/utils/api";
import { useCallback } from "react";
import { useOrganizationTeamProject } from "./useOrganizationTeamProject";
import { createLogger } from "~/utils/logger";

const logger = createLogger("useLocalStorageSelectedDataSetId");

/**
 * This hook is used to store the selected dataset id in the local storage.
 * @returns The selected dataset id and a function to set the selected dataset id.
 */
export const useLocalStorageSelectedDataSetId = () => {
  const { project } = useOrganizationTeamProject();
  const projectId = project?.id ?? "";
  const trpc = api.useContext();
  const [selectedDataSetId, setSelectedDataSetId] = useLocalStorage<string>(
    "selectedDatasetId",
    ""
  );

  const clear = () => {
    setSelectedDataSetId("");
  };

  const handleSetSelectedDataSetId = useCallback(
    async (datasetId: string) => {
      // If the dataset id is an empty string, clear the local storage and return early.
      if (datasetId === "") {
        clear();
        return;
      }

      try {
        const dataset = await trpc.dataset.getById.fetch({
          projectId: project?.id ?? "",
          datasetId,
        });

        const doesDatasetExist = !!dataset;

        if (doesDatasetExist) {
          setSelectedDataSetId(datasetId);
        } else {
          logger.warn(
            { datasetId },
            "Tried to set selected dataset to local storage, but it does not exist"
          );

          clear();
        }
      } catch (error) {
        logger.error({ error }, "Error fetching dataset");
        clear();
      }
    },
    [setSelectedDataSetId, trpc]
  );

  return {
    /**
     * The selected dataset id in local storage.
     */
    selectedDataSetId,
    /**
     * This function is used to set the selected dataset id in the local storage.
     * It will check if the dataset exists in the database and if not, it will
     * clear the local storage.
     */
    setSelectedDataSetId: handleSetSelectedDataSetId,
    /**
     * This function is used to clear the selected dataset id in the local storage.
     */
    clear,
  };
};
