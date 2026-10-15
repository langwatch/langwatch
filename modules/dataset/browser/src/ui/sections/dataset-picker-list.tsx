import { useOrganizationTeamProject } from "@langwatch/browser-host/use-organization-team-project";
import { datasetClient } from "@langwatch/dataset-client";

import { useDatasetRecordCounts } from "../../behavior/use-dataset-record-counts.ts";
import {
  DatasetPickerList as DatasetPickerListView,
  type DatasetPickerSelection,
} from "../blocks/dataset-picker-list.tsx";

export type { DatasetPickerSelection };

/** App transport adapter for the browser-safe Dataset picker view. */
export function DatasetPickerList({
  enabled = true,
  onSelect,
}: {
  enabled?: boolean;
  onSelect: (dataset: DatasetPickerSelection) => void;
}) {
  const { project } = useOrganizationTeamProject();
  const datasetsQuery = datasetClient.dataset.getAll.useQuery(
    { projectId: project?.id ?? "" },
    { enabled: !!project?.id && enabled },
  );
  const { recordCounts, countsFailed } = useDatasetRecordCounts({
    projectId: project?.id,
    datasets: datasetsQuery.data,
  });

  return (
    <DatasetPickerListView
      datasets={datasetsQuery.data}
      recordCounts={recordCounts}
      countsFailed={countsFailed}
      isLoading={datasetsQuery.isLoading}
      isError={datasetsQuery.isError}
      onSelect={onSelect}
    />
  );
}
