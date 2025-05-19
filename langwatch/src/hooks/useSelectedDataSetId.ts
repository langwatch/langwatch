import { useLocalStorage } from "usehooks-ts";

/**
 * This hook is used to store the selected dataset id in the local storage.
 * @returns The selected dataset id and a function to set the selected dataset id.
 */
export const useSelectedDataSetId = () => {
  const [selectedDataSetId, setSelectedDataSetId] = useLocalStorage<string>(
    "selectedDatasetId",
    ""
  );

  return {
    selectedDataSetId,
    setSelectedDataSetId,
    clear: () => setSelectedDataSetId(""),
  };
};
