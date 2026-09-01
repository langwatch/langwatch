/**
 * Appends rows from a CSV, JSON or JSONL file to a saved dataset.
 *
 * A family-local copy of
 * `platform/app/src/components/datasets/AddRowsFromCSVModal`, which the upload
 * drawer still renders. Deletes-only forbids repointing it, so the platform copy
 * stays for that flow and this one travels with the dataset editor. Two things
 * changed and nothing else: the dropzone is this package's own (see
 * `tabular-file-dropzone`), and the two notices go to the host rather than to a
 * toast singleton a package may not import.
 *
 * The mapping is FILE COLUMN -> DATASET COLUMN and every dataset column has to
 * be answered before the upload unlocks, because a column left unmapped would
 * append blank values rather than nothing.
 */

import { Box, Button, HStack, NativeSelect, Spacer, Text } from "@chakra-ui/react";
import {
  type DatasetColumns,
  type DatasetRecordEntry,
  newDatasetEntriesSchema,
} from "@langwatch/dataset-contract";
import { Dialog } from "@langwatch/design-system/dialog";
import { ArrowRight } from "lucide-react";
import { nanoid } from "nanoid";
import { useEffect, useMemo, useState } from "react";
import { datasetApi } from "../../behavior/dataset-api";
import { useDatasetHost } from "../../model/dataset-host";
import { convertDatasetRecordsToColumnTypes } from "../../model/convert-record-values";
import { TabularFileDropzone } from "./tabular-file-dropzone";

/** The value that maps a dataset column to nothing at all. */
const NO_SOURCE_COLUMN = "";

export function AddRowsFromCSVModal({
  isOpen,
  onClose,
  datasetId,
  columnTypes,
}: {
  isOpen: boolean;
  onClose: () => void;
  datasetId: string;
  columnTypes: DatasetColumns;
}) {
  const host = useDatasetHost();
  const project = host.project();
  const uploadRecords = datasetApi.datasetRecord.create.useMutation();

  const [fileHeaders, setFileHeaders] = useState<string[]>([]);
  const [fileRows, setFileRows] = useState<string[][]>([]);
  const [mapping, setMapping] = useState<Record<string, string>>({});

  // Reopening the modal is what resets it: a mapping built against the previous
  // file would silently answer for the next one.
  useEffect(() => {
    if (!isOpen) return;
    setFileHeaders([]);
    setFileRows([]);
    setMapping({});
  }, [isOpen]);

  const datasetColumnNames = useMemo(
    () => (columnTypes ?? []).map(({ name }) => name),
    [columnTypes],
  );

  const isMappingComplete = datasetColumnNames.every((column) =>
    Object.keys(mapping).includes(column),
  );

  const recordEntries: DatasetRecordEntry[] = useMemo(() => {
    if (fileRows.length === 0) return [];
    return fileRows.map((row) => {
      const entry: DatasetRecordEntry = { id: nanoid() };
      for (const name of datasetColumnNames) {
        const sourceHeader = mapping[name] ?? NO_SOURCE_COLUMN;
        const index = fileHeaders.indexOf(sourceHeader);
        entry[name] = index === -1 ? "" : (row[index] ?? "");
      }
      return entry;
    });
  }, [fileRows, fileHeaders, mapping, datasetColumnNames]);

  const upload = () => {
    let entries;
    try {
      entries = newDatasetEntriesSchema.parse({
        entries: convertDatasetRecordsToColumnTypes(recordEntries, columnTypes),
      });
    } catch (error) {
      host.failed({ error, fallbackTitle: "Couldn't read the values in that file" });
      return;
    }

    uploadRecords.mutate(
      { projectId: project?.id ?? "", datasetId, ...entries },
      {
        onSuccess: () => {
          setFileHeaders([]);
          setFileRows([]);
          setMapping({});
          onClose();
          host.succeeded({ title: "Rows added to the dataset" });
        },
        onError: (error) => {
          host.failed({ error, fallbackTitle: "Couldn't add the rows to this dataset" });
        },
      },
    );
  };

  return (
    <Dialog.Root open={isOpen} onOpenChange={({ open }) => !open && onClose()}>
      <Dialog.Content bg="bg">
        <Dialog.Header>
          <Dialog.Title>Add rows from CSV</Dialog.Title>
          <Dialog.CloseTrigger />
        </Dialog.Header>
        <Dialog.Body>
          <TabularFileDropzone
            onRows={(rows) => {
              setFileHeaders(rows[0] ?? []);
              setFileRows(rows.slice(1));
            }}
            onRemoved={() => {
              setFileHeaders([]);
              setFileRows([]);
            }}
            onParseFailed={(error) =>
              host.failed({ error, fallbackTitle: "Couldn't read that file" })
            }
          >
            {(hasAcceptedFile) =>
              hasAcceptedFile
                ? datasetColumnNames.map((column, index) => (
                    <HStack key={column} marginY={2}>
                      <Box width={200}>
                        <NativeSelect.Root>
                          <NativeSelect.Field
                            placeholder="Select column"
                            aria-label={`Source column for ${column}`}
                            value={mapping[column] ?? NO_SOURCE_COLUMN}
                            onChange={(event) =>
                              setMapping((current) => ({
                                ...current,
                                [column]: event.target.value,
                              }))
                            }
                          >
                            {fileHeaders.map((header) => (
                              <option key={header} value={header}>
                                {header}
                              </option>
                            ))}
                            <option value={NO_SOURCE_COLUMN}>Set empty</option>
                          </NativeSelect.Field>
                          <NativeSelect.Indicator />
                        </NativeSelect.Root>
                      </Box>
                      <ArrowRight size={16} aria-hidden data-index={index} />
                      <Spacer />
                      <Text>{column}</Text>
                    </HStack>
                  ))
                : null
            }
          </TabularFileDropzone>
        </Dialog.Body>

        <Dialog.Footer>
          <Button variant="ghost" marginRight={3} onClick={onClose}>
            Close
          </Button>
          <Button
            colorPalette="blue"
            disabled={recordEntries.length === 0 || !isMappingComplete}
            onClick={upload}
            loading={uploadRecords.isPending}
          >
            Upload
          </Button>
        </Dialog.Footer>
      </Dialog.Content>
    </Dialog.Root>
  );
}
