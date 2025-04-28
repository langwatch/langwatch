import { Dialog } from "~/components/ui/dialog";
import { Box, Button, Heading } from "@chakra-ui/react";
import { DatasetTable } from "~/components/datasets/DatasetTable";
import type { PromptConfigFormValues } from "../hooks/usePromptConfigForm";

type Demonstrations =
  PromptConfigFormValues["version"]["configData"]["demonstrations"];

export function DemonstrationsModal({
  open,
  onClose,
  demonstrations,
  onChange,
}: {
  open: boolean;
  onClose: () => void;
  demonstrations: Demonstrations;
  onChange: (demonstrations: Demonstrations) => void;
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
        data-testid="prompt-config-demonstrations-modal"
      >
        <Dialog.CloseTrigger zIndex={10} />
        <Dialog.Header>
          <Heading size="md">Edit Demonstrations</Heading>
        </Dialog.Header>
        <Dialog.Body paddingBottom="32px">
          <Box position="relative">
            <DatasetTable
              inMemoryDataset={{
                name: "Demonstrations",
                datasetRecords: demonstrations?.rows ?? [],
                columnTypes: demonstrations?.columns ?? [],
              }}
              onUpdateDataset={(dataset) =>
                onChange({
                  columns: dataset.columnTypes.map((column) => ({
                    ...column,
                    id: column.name,
                  })),
                  rows: dataset.datasetRecords,
                })
              }
              canEditDatasetRecord={false}
            />
            {/** This is a hacky way to get a button on here, but we're pressed for time */}
            <Button
              colorPalette="blue"
              position="absolute"
              bottom="0"
              right="24px"
              onClick={() => {
                onClose();
              }}
            >
              Close
            </Button>
          </Box>
        </Dialog.Body>
      </Dialog.Content>
    </Dialog.Root>
  );
}
