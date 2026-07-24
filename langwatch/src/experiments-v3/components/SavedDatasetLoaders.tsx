import { useSavedDatasetRecords } from "../hooks/useSavedDatasetLoader";
import type { DatasetReference } from "../types";

/**
 * Loads records for a single saved dataset.
 * Renders nothing - just triggers the fetch.
 */
const SavedDatasetLoader = ({ dataset }: { dataset: DatasetReference }) => {
  useSavedDatasetRecords(dataset);
  return null;
};

/**
 * Component that triggers loading for all saved datasets.
 * Each dataset gets its own query - tRPC handles batching automatically.
 * Renders nothing visible.
 */
export const SavedDatasetLoaders = ({
  datasets,
}: {
  datasets: DatasetReference[];
}) => {
  const savedDatasets = datasets.filter(
    (d) => d.type === "saved" && d.datasetId && !d.savedRecords,
  );

  return (
    <>
      {savedDatasets.map((dataset) => (
        <SavedDatasetLoader key={dataset.id} dataset={dataset} />
      ))}
    </>
  );
};
