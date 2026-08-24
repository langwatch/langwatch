import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { api } from "~/utils/api";
import {
  DatasetPickerList as DatasetPickerListView,
  type DatasetPickerSelection,
} from "@langwatch/dataset-web";

export type { DatasetPickerSelection } from "@langwatch/dataset-web";

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
