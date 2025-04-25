import { Dialog } from "../../ui/dialog";
import { Box, Heading } from "@chakra-ui/react";
import {
  DatasetTable,
  type InMemoryDataset,
} from "../../datasets/DatasetTable";
import type { PromptConfigFormValues } from "../hooks/usePromptConfigForm";

/**
 * Component to render the dataset table with demonstrations
 */
function DemonstrationsDatasetTable({
  demonstrations,
  onUpdate,
}: {
  demonstrations: PromptConfigFormValues["version"]["demonstrations"];
  onUpdate: (dataset: InMemoryDataset) => void;
}) {
  return (
    <Box position="relative">
      <DatasetTable
        inMemoryDataset={{
          name: "Demonstrations",
          datasetRecords: demonstrations.rows ?? [],
          columnTypes: demonstrations.columns ?? [
            { name: "input", type: "string" },
            { name: "output", type: "string" },
          ],
        }}
        onUpdateDataset={onUpdate}
        isEmbedded={false}
        insideWizard={false}
        title="Demonstrations"
        hideButtons={false}
        bottomSpace="268px"
        loadingOverlayComponent={null}
      />
    </Box>
  );
}

export function DemonstrationsModal({
  open,
  onClose,
  demonstrations,
  onChange,
}: {
  open: boolean;
  onClose: () => void;
  demonstrations: PromptConfigFormValues["version"]["demonstrations"];
  onChange: (
    demonstrations: PromptConfigFormValues["version"]["demonstrations"]
  ) => void;
}) {
  return (
    <Dialog.Root open={open} onOpenChange={({ open }) => !open && onClose()}>
      <Dialog.Backdrop />
      <Dialog.Content
        marginX="32px"
        marginTop="32px"
        maxWidth="calc(100vw - 64px)"
        minHeight="0"
        height="calc(100vh - 64px)"
        borderRadius="8px"
        overflowY="auto"
      >
        <Dialog.CloseTrigger zIndex={10} />
        <Dialog.Header>
          <Heading size="md">Edit Demonstrations</Heading>
        </Dialog.Header>
        <Dialog.Body paddingBottom="32px">
          <DemonstrationsDatasetTable
            demonstrations={demonstrations}
            onUpdate={(dataset) =>
              onChange({
                columns: dataset.columnTypes,
                rows: dataset.datasetRecords,
              })
            }
          />
        </Dialog.Body>
      </Dialog.Content>
    </Dialog.Root>
  );
}
