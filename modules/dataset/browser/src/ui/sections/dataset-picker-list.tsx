import { useOrganizationTeamProject } from "@langwatch/browser-host/use-organization-team-project";
import { api } from "@langwatch/browser-trpc/workflow-api";

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
  const datasetsQuery = api.dataset.getAll.useQuery(
    { projectId: project?.id ?? "" },
    { enabled: !!project?.id && enabled },
  );

  return (
    <DatasetPickerListView
      datasets={datasetsQuery.data}
      isLoading={datasetsQuery.isLoading}
      isError={datasetsQuery.isError}
      onSelect={onSelect}
    />
  );
}
