import { Button, HStack, Text } from "@chakra-ui/react";
import { Database } from "react-feather";

import { Drawer } from "~/components/ui/drawer";
import { getComplexProps, useDrawer } from "~/hooks/useDrawer";
import type { DatasetColumns } from "~/server/datasets/types";
import { DatasetPickerList } from "./DatasetPickerList";

export type SelectDatasetDrawerProps = {
  open?: boolean;
  onClose?: () => void;
  onSelect?: (dataset: {
    datasetId: string;
    name: string;
    columnTypes: DatasetColumns;
  }) => void;
};

/**
 * Drawer for selecting an existing dataset from the project. Hosts the
 * shared DatasetPickerList (search + cards with entry/column counts and
 * last-edit date); reusable across the app via useDrawer.
 */
export function SelectDatasetDrawer(props: SelectDatasetDrawerProps) {
  const { closeDrawer } = useDrawer();
  const complexProps = getComplexProps();

  const onClose = props.onClose ?? closeDrawer;
  const onSelect =
    props.onSelect ??
    (complexProps.onSelect as SelectDatasetDrawerProps["onSelect"]);
  // Note: props.open can be a string (drawer name) from CurrentDrawer, convert to boolean
  const isOpen = props.open !== false && props.open !== undefined;

  return (
    <Drawer.Root
      open={isOpen}
      onOpenChange={({ open }) => !open && onClose()}
      size="md"
    >
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
            enabled={isOpen}
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
