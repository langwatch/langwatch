import {
  Box,
  Button,
  Modal,
  ModalBody,
  ModalCloseButton,
  ModalContent,
  ModalFooter,
  ModalHeader,
  ModalOverlay,
  Text,
  useDisclosure,
  VStack,
} from "@chakra-ui/react";
import { useEffect, useState } from "react";
import {
  type DatasetColumns,
  type DatasetRecordEntry,
} from "../../server/datasets/types";
import { nanoid } from "nanoid";
import { formatFileSize, useCSVReader } from "react-papaparse";
import type { InMemoryDataset } from "./DatasetTable";
import { AddOrEditDatasetDrawer } from "../AddOrEditDatasetDrawer";

export const MAX_ROWS_LIMIT = 10_000;

export function UploadCSVModal({
  isOpen,
  onClose,
  onSuccess,
}: {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: Parameters<typeof AddOrEditDatasetDrawer>[0]["onSuccess"];
}) {
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
      <Modal isOpen={localIsOpen} onClose={onClose}>
        <ModalOverlay />
        <ModalContent>
          <ModalHeader>Upload CSV</ModalHeader>
          <ModalCloseButton />
          <ModalBody>
            <CSVReaderComponent
              onUploadAccepted={({ data, acceptedFile }) => {
                const columns: DatasetColumns = (data[0] ?? []).map(
                  (col: string) => ({
                    name: col,
                    type: "string",
                  })
                );
                const records: DatasetRecordEntry[] = data
                  .slice(1)
                  .map((row: string[]) => ({
                    id: nanoid(),
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
            {uploadedDataset &&
              uploadedDataset.datasetRecords.length > MAX_ROWS_LIMIT && (
                <Text color="red.500" paddingTop={4}>
                  Sorry, the max number of rows accepted for datasets is
                  currently {MAX_ROWS_LIMIT} rows. Please reduce the number of
                  rows or contact support.
                </Text>
              )}
          </ModalBody>

          <ModalFooter>
            <Button variant="ghost" mr={3} onClick={onClose}>
              Close
            </Button>
            <Button
              colorScheme="blue"
              isDisabled={
                !uploadedDataset ||
                uploadedDataset.datasetRecords.length === 0 ||
                uploadedDataset.datasetRecords.length > MAX_ROWS_LIMIT
              }
              onClick={uploadCSVData}
            >
              Upload
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
      <AddOrEditDatasetDrawer
        datasetToSave={uploadedDataset}
        isOpen={addDatasetDrawer.isOpen}
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
      onUploadAccepted={(results: { data: string[][] }) => {
        setResults(results);
        setZoneHover(false);
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
        "Drop CSV file here or click to upload"
      )}
    </Box>
  );
}
