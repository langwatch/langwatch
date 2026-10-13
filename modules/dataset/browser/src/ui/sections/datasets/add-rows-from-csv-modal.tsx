import { toaster } from "@langwatch/browser-host/toaster";
import { useOrganizationTeamProject } from "@langwatch/browser-host/use-organization-team-project";
import { datasetClient } from "@langwatch/dataset-client";
import {
  type DatasetColumns,
  type DatasetRecordEntry,
  newDatasetEntriesSchema,
} from "@langwatch/dataset-contract";
import { Dialog } from "@langwatch/design-system/dialog";
import { Box, HStack, NativeSelect, Spacer, Text } from "@langwatch/design-system/primitives";
import { generate } from "@langwatch/ksuid";
import { createLogger } from "@langwatch/observability/browser";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowRight } from "react-feather";

import { convertDatasetRecordsToColumnTypes } from "../../../model/convert-record-values.ts";
import { CSVReaderComponent } from "./upload-csv-drawer.tsx";

const logger = createLogger("langwatch:dataset:add-rows-from-csv");

/**
 * The app's KSUID resource for a dataset record row (`KSUID_RESOURCES.RECORD`).
 * The literal, not the constant table: the id this widget mints is sent to
 * the server as-is and persisted, so it belongs with the writer.
 */
const RECORD_KSUID_RESOURCE = "record";

type UploadStep = "choose-file" | "map-columns" | "upload";

/** Where an Upload attempt stands: no data rows yet, a column left unmapped, or ready. */
function uploadStepOf({ csvRows, canUpload }: { csvRows: number; canUpload: boolean }): UploadStep {
  if (csvRows <= 1) return "choose-file";
  return canUpload ? "upload" : "map-columns";
}

const STEP_PROBLEMS: Record<UploadStep, string | undefined> = {
  "choose-file": "Choose a CSV file with at least one row.",
  "map-columns": "Choose a CSV column for every dataset column.",
  upload: void 0,
};

function UploadNotices({
  problem,
  hasFormatErrors,
}: {
  problem: string | undefined;
  hasFormatErrors: boolean;
}) {
  return (
    <>
      {problem && (
        <Text role="alert" color="red.fg">
          {problem}
        </Text>
      )}
      {hasFormatErrors && <Text color="red.fg">Please check columns have valid formatting</Text>}
    </>
  );
}

/** Puts focus on the first dataset column that has no CSV column chosen yet. */
function focusFirstUnmapped({
  body,
  columnTypes,
  mapping,
}: {
  body: HTMLElement | null;
  columnTypes: DatasetColumns;
  mapping: Record<string, string>;
}): void {
  const unmapped = columnTypes.findIndex(({ name }) => !Object.keys(mapping).includes(name));
  body?.querySelectorAll("select")[unmapped]?.focus();
}

export function AddRowsFromCSVModal({
  isOpen,
  onClose,
  datasetId,
  columnTypes,
  onUpdateDataset,
}: {
  isOpen: boolean;
  onClose: () => void;
  datasetId?: string;
  columnTypes: DatasetColumns;
  onUpdateDataset?: (entries: DatasetRecordEntry[]) => void;
}) {
  const { project } = useOrganizationTeamProject();
  // The rows this modal adds are read back by whoever shows the dataset, so
  // their cached reads are marked stale rather than loading the dataset here.
  const utils = datasetClient.useUtils();

  const [recordEntries, setRecordEntries] = useState<DatasetRecordEntry[]>([]);
  const [CSVHeaders, setCSVHeaders] = useState<string[]>([]);
  const [hasErrors, setErrors] = useState<string[]>([]);
  const [csvUploaded, setCSVUploaded] = useState<string[][]>([]);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const uploadRecords = datasetClient.datasetRecord.create.useMutation();

  const preprocessCSV = (csv: string[][]) => {
    setCSVHeaders(csv[0] ?? []);
    setCSVUploaded(csv);
  };

  function safeGetRowValue(row: string[], headers: string[], key: string): string {
    const index = headers.indexOf(key);
    return index !== -1 ? (row[index] ?? "") : "";
  }

  const setupRecordsUpload = (mappings: Record<string, string>) => {
    const records: DatasetRecordEntry[] = [];

    csvUploaded.slice(1).forEach((row) => {
      const entry: DatasetRecordEntry = {
        id: generate(RECORD_KSUID_RESOURCE).toString(),
      };

      for (const { name } of columnTypes) {
        entry[name] = safeGetRowValue(row, CSVHeaders, mappings[name] ?? "");
      }

      records.push(entry);
    });

    setRecordEntries(records);
    preprocessCSV(csvUploaded);
  };

  const isMappingsComplete = useCallback(() => {
    const columns = (columnTypes ?? []).map(({ name }) => name);
    return columns.every((column) => Object.keys(mapping).includes(column));
  }, [columnTypes, mapping]);

  const canUpload = isMappingsComplete();
  const [attempted, setAttempted] = useState(false);
  const bodyRef = useRef<HTMLDivElement>(null);
  const step = uploadStepOf({ csvRows: csvUploaded.length, canUpload });
  const problem = attempted ? STEP_PROBLEMS[step] : void 0;

  const onSelectChange = (map: string) => (value: string) => {
    const column = value;

    if (!map || !column) return;
    mapping[map] = column;

    setMapping((prevMapping) => ({
      ...prevMapping,
      [map]: column,
    }));
    setupRecordsUpload(mapping);
  };

  const uploadCSVData = () => {
    let entries;
    try {
      entries = newDatasetEntriesSchema.parse({
        entries: convertDatasetRecordsToColumnTypes(recordEntries, columnTypes),
      });
    } catch (error) {
      logger.error({ error }, "Failed to process CSV");
      toaster.create({
        title: "Error processing CSV",
        type: "error",
        duration: 5000,
      });

      return;
    }

    if (onUpdateDataset) {
      onUpdateDataset(entries.entries);
    }

    if (!datasetId) return;

    uploadRecords.mutate(
      {
        projectId: project?.id ?? "",
        datasetId: datasetId,
        ...entries,
      },
      {
        onSuccess: () => {
          void utils.datasetRecord.invalidate();
          setRecordEntries([]);
          setMapping({});
          onClose();
          toaster.create({
            title: "CSV uploaded successfully",
            type: "success",
            duration: 5000,
          });
        },
        onError: () => {
          toaster.create({
            title: "Error uploading CSV",
            description:
              "Please make sure you have the right formatting and that the columns are correct",
            type: "error",
            duration: 5000,
          });
        },
      },
    );
  };

  const submitUpload = () => {
    setAttempted(true);
    if (step === "map-columns") focusFirstUnmapped({ body: bodyRef.current, columnTypes, mapping });
    if (step === "upload" && recordEntries.length > 0 && hasErrors.length === 0) uploadCSVData();
  };

  const selectMappings = useMemo(() => {
    const columns = (columnTypes ?? []).map(({ name }) => name);
    return columns.map((col) => ({
      value: col,
    }));
  }, [columnTypes]);

  const renderMapping = (hasAcceptedFile: boolean) => {
    if (!hasAcceptedFile) return;

    return selectMappings.map((option, index) => {
      return (
        <HStack key={index} marginY={2}>
          <Box width={200}>
            <NativeSelect.Root>
              <NativeSelect.Field
                placeholder="Select column"
                onChange={(e) => {
                  onSelectChange(option.value)(e.target.value);
                }}
                value={mapping[option.value]}
              >
                {CSVHeaders.map((column) => (
                  <option key={column} value={column}>
                    {column}
                  </option>
                ))}
                <option value="">Set empty</option>
              </NativeSelect.Field>
              <NativeSelect.Indicator />
            </NativeSelect.Root>
          </Box>

          <ArrowRight />
          <Spacer />
          <Text>{option.value}</Text>
        </HStack>
      );
    });
  };

  useEffect(() => {
    if (isOpen) {
      setRecordEntries([]);
      setMapping({});
      setCSVHeaders([]);
      setCSVUploaded([]);
      setErrors([]);
      setAttempted(false);
    }
  }, [isOpen]);

  return (
    <Dialog
      open={isOpen}
      onClose={onClose}
      title="Add rows from CSV"
      cancelLabel="Close"
      busy={uploadRecords.isPending}
      primaryAction={{
        label: "Upload",
        onClick: submitUpload,
        loading: uploadRecords.isPending,
        "data-testid": "dataset-add-rows-submit",
      }}
    >
      <Box ref={bodyRef}>
        <CSVReaderComponent
          onUploadAccepted={({ data }: { data: string[][] }) => {
            preprocessCSV(data);
          }}
        >
          {renderMapping}
        </CSVReaderComponent>
      </Box>
      <UploadNotices problem={problem} hasFormatErrors={hasErrors.length > 0} />
    </Dialog>
  );
}
