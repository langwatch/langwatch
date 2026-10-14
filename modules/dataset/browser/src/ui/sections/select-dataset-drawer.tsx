/** SelectDataset drawer (cross-family opener, registered). Drawer from Design
 * System, query cached under tRPC path-plus-input key.
 */

import { getComplexProps, useDrawer } from "@langwatch/browser-host/drawer";
import { datasetClient } from "@langwatch/dataset-client";
import type { UiSelectDatasetDrawerProps } from "@langwatch/dataset-client";
import { Drawer } from "@langwatch/design-system/drawer";
import { Database } from "lucide-react";

import { useDatasetRecordCounts } from "../../behavior/use-dataset-record-counts.ts";
import { useDatasetHost } from "../../model/dataset-host.ts";
import { DatasetPickerList } from "../blocks/dataset-picker-list.tsx";

export type SelectDatasetDrawerProps = UiSelectDatasetDrawerProps;

export function SelectDatasetDrawer(props: SelectDatasetDrawerProps) {
  const { closeDrawer } = useDrawer();
  const complexProps = getComplexProps();
  const host = useDatasetHost();
  const projectId = host.project()?.id;

  const onClose = props.onClose ?? closeDrawer;
  const onSelect =
    props.onSelect ?? (complexProps.onSelect as SelectDatasetDrawerProps["onSelect"]);
  // `props.open` arrives from the address as the drawer NAME, not a boolean:
  // the registry spreads the parsed `drawer.*` object straight onto the
  // component. Anything defined and not `false` means open.
  const isOpen = props.open !== false && props.open !== undefined;

  const datasets = datasetClient.dataset.getAll.useQuery(
    { projectId: projectId ?? "" },
    { enabled: isOpen && !!projectId },
  );
  const { recordCounts, countsFailed } = useDatasetRecordCounts({
    projectId,
    datasets: datasets.data,
  });

  return (
    <Drawer
      open={isOpen}
      onClose={onClose}
      size="md"
      title="Choose Dataset"
      icon={<Database size={20} />}
      subtitle="Select an existing dataset to use for this evaluation."
      bodyScroll="content"
      footer={{ cancel: { onClick: onClose } }}
    >
      <DatasetPickerList
        datasets={datasets.data}
        recordCounts={recordCounts}
        countsFailed={countsFailed}
        isLoading={datasets.isLoading}
        isError={datasets.isError}
        onSelect={(dataset) => {
          onSelect?.(dataset);
          onClose();
        }}
      />
    </Drawer>
  );
}
