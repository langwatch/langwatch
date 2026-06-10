import { Button, Heading } from "@chakra-ui/react";
import { DatasetEditorTable } from "~/components/datasets/editor/DatasetEditorTable";
import { Dialog } from "~/components/ui/dialog";
import type { PromptConfigFormValues } from "~/prompts";
import {
  transposeColumnsFirstToRowsFirstWithId,
  transpostRowsFirstToColumnsFirstWithoutId,
} from "../../optimization_studio/utils/datasetUtils";

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
  const transposedRecords = transposeColumnsFirstToRowsFirstWithId(
    demonstrations?.inline?.records ?? {},
  );

  return (
    <Dialog.Root open={open} onOpenChange={({ open }) => !open && onClose()}>
      <Dialog.Content bg="bg"
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
        <Dialog.Body paddingBottom="16px">
          <DatasetEditorTable
            inMemoryDataset={{
              name: "Demonstrations",
              datasetRecords: transposedRecords,
              columnTypes: demonstrations?.inline?.columnTypes ?? [],
            }}
            onUpdateDataset={(dataset) =>
              onChange({
                inline: {
                  columnTypes: dataset.columnTypes,
                  records: transpostRowsFirstToColumnsFirstWithoutId(
                    dataset.datasetRecords,
                  ),
                },
              })
            }
            canEditDatasetRecord={false}
          />
        </Dialog.Body>
        <Dialog.Footer>
          <Button colorPalette="blue" onClick={onClose}>
            Close
          </Button>
        </Dialog.Footer>
      </Dialog.Content>
    </Dialog.Root>
  );
}
