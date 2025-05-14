import { useLocalStorage } from "usehooks-ts";

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
