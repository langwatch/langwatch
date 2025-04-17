import {
  Box,
  Button,
  HStack,
  Spacer,
  Text,
  useDisclosure,
  VStack,
} from "@chakra-ui/react";
import { useEffect, useState } from "react";
import {
  type DatasetColumns,
  type DatasetRecordEntry,
} from "../../server/datasets/types";
import {
  formatFileSize,
  jsonToCSV,
  useCSVReader,
  usePapaParse,
} from "react-papaparse";
import type { InMemoryDataset } from "./DatasetTable";
import { AddOrEditDatasetDrawer } from "../AddOrEditDatasetDrawer";
import { useDrawer } from "../CurrentDrawer";
import { Dialog } from "../../components/ui/dialog";
import { toaster } from "../ui/toaster";

export const MAX_ROWS_LIMIT = 10_000;

export function UploadCSVModal({
  isOpen: isOpen_,
  onClose: onClose_,
  onSuccess,
  onCreateFromScratch,
}: {
  isOpen?: boolean;
  onClose?: () => void;
  onSuccess: Parameters<typeof AddOrEditDatasetDrawer>[0]["onSuccess"];
  onCreateFromScratch?: () => void;
}) {
  const { closeDrawer } = useDrawer();
  const onClose = onClose_ ?? closeDrawer;
  const isOpen = isOpen_ ?? true;

  const addDatasetDrawer = useDisclosure();
  const [localIsOpen, setLocalIsOpen] = useState(isOpen);
  const [uploadedDataset, setUploadedDataset] = useState<
    InMemoryDataset | undefined
  >(undefined);

  const uploadCSVData = () => {
    setLocalIsOpen(false);
    addDatasetDrawer.onOpen();
  };

  useEffect(() => {
    setLocalIsOpen(isOpen);
    if (!isOpen) {
      setUploadedDataset(undefined);
      addDatasetDrawer.onClose();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  return (
    <>
      <Dialog.Root
        open={localIsOpen}
        onOpenChange={({ open }) => !open && onClose()}
      >
        <Dialog.Backdrop />
        <Dialog.Content>
          <Dialog.Header>
            <Dialog.Title>Upload CSV</Dialog.Title>
            <Dialog.CloseTrigger />
          </Dialog.Header>
          <Dialog.Body>
            <UploadCSVForm
              setUploadedDataset={setUploadedDataset}
              uploadedDataset={uploadedDataset}
              uploadCSVData={uploadCSVData}
              onCreateFromScratch={onCreateFromScratch}
            />
          </Dialog.Body>
        </Dialog.Content>
      </Dialog.Root>
      <AddOrEditDatasetDrawer
        datasetToSave={uploadedDataset}
        open={addDatasetDrawer.open}
        onClose={() => {
          addDatasetDrawer.onClose();
          onClose();
        }}
        onSuccess={(params) => {
          onSuccess(params);
          onClose();
        }}
      />
    </>
  );
}

export function InlineUploadCSVForm({
  onSuccess,
}: {
  onSuccess: Parameters<typeof AddOrEditDatasetDrawer>[0]["onSuccess"];
}) {
  const addDatasetDrawer = useDisclosure();
  const [uploadedDataset, setUploadedDataset] = useState<
    InMemoryDataset | undefined
  >(undefined);

  return (
    <>
      <UploadCSVForm
        setUploadedDataset={setUploadedDataset}
        uploadedDataset={uploadedDataset}
        uploadCSVData={addDatasetDrawer.onOpen}
        disabled={addDatasetDrawer.open}
      />
      <AddOrEditDatasetDrawer
        datasetToSave={uploadedDataset}
        open={addDatasetDrawer.open}
        onClose={() => {
          addDatasetDrawer.onClose();
        }}
        onSuccess={(params) => {
          onSuccess(params);
        }}
      />
    </>
  );
}

export function UploadCSVForm({
  setUploadedDataset,
  uploadedDataset,
  onCreateFromScratch,
  uploadCSVData,
  disabled,
}: {
  setUploadedDataset: (dataset: InMemoryDataset | undefined) => void;
  uploadedDataset: InMemoryDataset | undefined;
  onCreateFromScratch?: () => void;
  uploadCSVData: () => void;
  disabled?: boolean;
}) {
  return (
    <VStack width="full" align="start" gap={4}>
      <CSVReaderComponent
        onUploadAccepted={({ data, acceptedFile }) => {
          const columns: DatasetColumns = (data[0] ?? []).map(
            (col: string) => ({
              name: col,
              type: "string",
            })
          );
          const now = new Date().getTime();
          const records: DatasetRecordEntry[] = data
            .slice(1)
            .map((row: string[], index: number) => ({
              id: `${now}-${index}`,
              ...Object.fromEntries(
                row.map((col, i) => [columns[i]?.name, col])
              ),
            }));

          setUploadedDataset({
            datasetRecords: records,
            columnTypes: columns,
            name: acceptedFile.name.split(".")[0],
          });
        }}
        onUploadRemoved={() => {
          setUploadedDataset(undefined);
        }}
      />
      <HStack width="full" align="end">
        {uploadedDataset &&
          uploadedDataset.datasetRecords.length > MAX_ROWS_LIMIT && (
            <Text color="red.500" paddingTop={4}>
              Sorry, the max number of rows accepted for datasets is currently{" "}
              {MAX_ROWS_LIMIT} rows. Please reduce the number of rows or contact
              support.
            </Text>
          )}

        {onCreateFromScratch && (
          <Button
            variant="plain"
            colorPalette="gray"
            fontWeight="normal"
            color="blue.700"
            onClick={onCreateFromScratch}
          >
            Skip, create empty dataset
          </Button>
        )}
        <Spacer />
        <Button
          colorPalette="blue"
          disabled={
            !!disabled ||
            !uploadedDataset ||
            uploadedDataset.datasetRecords.length === 0 ||
            uploadedDataset.datasetRecords.length > MAX_ROWS_LIMIT
          }
          onClick={uploadCSVData}
        >
          Upload
        </Button>
      </HStack>
    </VStack>
  );
}

export function CSVReaderComponent({
  onUploadAccepted,
  onUploadRemoved,
  children,
}: {
  onUploadAccepted: (results: { data: string[][]; acceptedFile: File }) => void;
  onUploadRemoved?: () => void;
  children?: (acceptedFile: boolean) => React.ReactNode;
}) {
  const { CSVReader } = useCSVReader();
  const [zoneHover, setZoneHover] = useState(false);
  const [acceptedFile, setAcceptedFile] = useState<File | null>(null);
  const [results, setResults] = useState<{ data: string[][] } | null>(null);
  const { readString } = usePapaParse();

  useEffect(() => {
    if (acceptedFile && results) {
      onUploadAccepted({ ...results, acceptedFile });
    } else if (!acceptedFile) {
      onUploadRemoved?.();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [acceptedFile, results]);

  return (
    <CSVReader
      accept=".csv,.json,.jsonl"
      onUploadAccepted={async (results: { data: string[][] }, file: File) => {
        if (file.name.endsWith(".jsonl") || file.name.endsWith(".json")) {
          try {
            const contents = await file.text();
            let jsonContents;
            console.log("contents", contents);
            try {
              jsonContents = JSON.parse(contents);
            } catch (error) {
              // If the file is not a valid JSON, try to parse it as a JSONL file
              jsonContents = JSON.parse(
                "[" +
                  contents
                    .trim()
                    .split("\n")
                    .filter((line) => line.trim() !== "")
                    .join(", ") +
                  "]"
              );
            }
            readString(jsonToCSV(jsonContents), {
              complete: (results) => {
                console.log("results", results);
                setResults({ data: results.data as string[][] });
              },
            });
          } catch (error) {
            console.error("error", error);
            toaster.create({
              title: "Error",
              description: "Failed to parse JSON file",
              type: "error",
              meta: {
                closable: true,
              },
              placement: "top-end",
            });
          }
        } else {
          setResults(results);
          setZoneHover(false);
        }
      }}
      onDragOver={(event: DragEvent) => {
        event.preventDefault();
        setZoneHover(true);
      }}
      onDragLeave={(event: DragEvent) => {
        event.preventDefault();
        setZoneHover(false);
      }}
    >
      {({
        getRootProps,
        acceptedFile,
        ProgressBar,
        getRemoveFileProps,
        Remove,
      }: any) => {
        return (
          <>
            <CSVReaderBox
              acceptedFile={acceptedFile}
              setAcceptedFile={setAcceptedFile}
              zoneHover={zoneHover}
              getRootProps={getRootProps}
              getRemoveFileProps={getRemoveFileProps}
              Remove={Remove}
              ProgressBar={ProgressBar}
            />
            {children ? children(acceptedFile) : null}
          </>
        );
      }}
    </CSVReader>
  );
}

function CSVReaderBox({
  acceptedFile,
  setAcceptedFile,
  zoneHover,
  getRootProps,
  getRemoveFileProps,
  Remove,
  ProgressBar,
}: {
  acceptedFile: File | null;
  setAcceptedFile: (file: File | null) => void;
  zoneHover: boolean;
  getRootProps: () => any;
  getRemoveFileProps: () => any;
  Remove: () => any;
  ProgressBar: () => any;
}) {
  useEffect(() => {
    setAcceptedFile(acceptedFile);
  }, [acceptedFile, setAcceptedFile]);

  return (
    <Box
      {...getRootProps()}
      borderRadius={"lg"}
      borderWidth={2}
      borderColor={zoneHover ? "gray.400" : "gray.200"}
      borderStyle="dashed"
      padding={10}
      textAlign="center"
      cursor="pointer"
      width="full"
    >
      {acceptedFile ? (
        <>
          <Box
            bg="gray.100"
            padding={4}
            borderRadius={"lg"}
            position="relative"
          >
            <VStack>
              <Text>{formatFileSize(acceptedFile.size)}</Text>
              <Text>{acceptedFile.name}</Text>
            </VStack>
            <ProgressBar />

            <Box
              position="absolute"
              right={-1}
              top={-1}
              {...getRemoveFileProps()}
            >
              <Remove />
            </Box>
          </Box>
        </>
      ) : (
        <Text>Drop CSV or JSONL file or click here to upload</Text>
      )}
    </Box>
  );
}
