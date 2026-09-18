/** SelectDataset drawer (cross-family opener, registered). Drawer from Design
 * System, query cached under tRPC path-plus-input key.
 */

import { Button, HStack, Text } from "@chakra-ui/react";
import { getComplexProps, useDrawer } from "@langwatch/browser-host/drawer";
import { Drawer } from "@langwatch/design-system/drawer";
import { Database } from "lucide-react";

import { datasetApi } from "../../behavior/dataset-api.ts";
import { useDatasetHost } from "../../model/dataset-host.ts";
import { DatasetPickerList, type DatasetPickerSelection } from "../blocks/dataset-picker-list.tsx";

export type SelectDatasetDrawerProps = {
  open?: boolean;
  onClose?: () => void;
  onSelect?: (dataset: DatasetPickerSelection) => void;
};

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

  const datasets = datasetApi.dataset.getAll.useQuery(
    { projectId: projectId ?? "" },
    { enabled: isOpen && !!projectId },
  );

  return (
    <Drawer.Root open={isOpen} onOpenChange={({ open }) => !open && onClose()} size="md">
      <Drawer.Content bg="bg">
        <Drawer.CloseTrigger />
        <Drawer.Header>
          <HStack gap={2}>
            <Database size={20} />
            <Text fontSize="xl" fontWeight="semibold">
              Choose Dataset
            </Text>
          </HStack>
        </Drawer.Header>
        <Drawer.Body
          display="flex"
          flexDirection="column"
          overflow="hidden"
          paddingX={6}
          paddingTop={4}
        >
          <Text color="fg.muted" fontSize="sm" paddingBottom={4}>
            Select an existing dataset to use for this evaluation.
          </Text>
          <DatasetPickerList
            datasets={datasets.data}
            isLoading={datasets.isLoading}
            isError={datasets.isError}
            onSelect={(dataset) => {
              onSelect?.(dataset);
              onClose();
            }}
          />
        </Drawer.Body>
        <Drawer.Footer borderTopWidth="1px" borderColor="border">
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
        </Drawer.Footer>
      </Drawer.Content>
    </Drawer.Root>
  );
}
