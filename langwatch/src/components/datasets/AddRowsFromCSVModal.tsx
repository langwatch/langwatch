import {
  Box,
  Button,
  HStack,
  Modal,
  ModalBody,
  ModalCloseButton,
  ModalContent,
  ModalFooter,
  ModalHeader,
  ModalOverlay,
  Select,
  Spacer,
  Text,
  useToast,
} from "@chakra-ui/react";
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ChangeEvent,
} from "react";
import { ArrowRight } from "react-feather";
import { useOrganizationTeamProject } from "../../hooks/useOrganizationTeamProject";
import {
  newDatasetEntriesSchema,
  type DatasetColumns,
  type DatasetRecordEntry,
} from "../../server/datasets/types";
import { api } from "../../utils/api";

import { nanoid } from "nanoid";
import { CSVReaderComponent } from "./UploadCSVModal";
import { tryToConvertRowsToAppropriateType } from "../AddOrEditDatasetDrawer";

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
  const dataset = api.datasetRecord.getAll.useQuery(
    { projectId: project?.id ?? "", datasetId: datasetId ?? "" },
    {
      enabled: !!project && !!datasetId,
      refetchOnWindowFocus: false,
    }
  );

  const [recordEntries, setRecordEntries] = useState<DatasetRecordEntry[]>([]);
  const [CSVHeaders, setCSVHeaders] = useState([]);
  const [hasErrors, setErrors] = useState<string[]>([]);
  const [csvUploaded, setCSVUploaded] = useState([]);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [canUpload, setCanUpload] = useState(false);
  const uploadRecords = api.datasetRecord.create.useMutation();

  const toast = useToast();

  const preprocessCSV = (csv: any) => {
    setCSVHeaders(csv.slice(0, 1)[0]);
    setCSVUploaded(csv);
  };

  function safeGetRowValue(row: any[], headers: string[], key: string): string {
    const index = headers.indexOf(key);
    return index !== -1 ? row[index] : "";
  }

  const setupRecordsUpload = (mappings: Record<string, string>) => {
    const records: DatasetRecordEntry[] = [];

    csvUploaded.slice(1).forEach((row: any) => {
      const entry: DatasetRecordEntry = {
        id: nanoid(),
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

  useEffect(() => {
    setCanUpload(isMappingsComplete());
  }, [isMappingsComplete, mapping]);

  const onSelectChange = (value: string) => {
    const [map, column] = value.split("-");

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
        entries: tryToConvertRowsToAppropriateType(recordEntries, columnTypes),
      });
    } catch (error) {
      console.error(error);
      toast({
        title: "Error processing CSV",
        status: "error",
        duration: 5000,
        isClosable: true,
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
          void dataset.refetch();
          setRecordEntries([]);
          setMapping({});
          onClose();
          toast({
            title: "CSV uploaded successfully",
            status: "success",
            duration: 5000,
            isClosable: true,
          });
        },
        onError: () => {
          toast({
            title: "Error uploading CSV",
            description:
              "Please make sure you have the right formatting and that the columns are correct",
            status: "error",
            duration: 5000,
            isClosable: true,
          });
        },
      }
    );
  };

  const selectMappings = useMemo(() => {
    const columns = (columnTypes ?? []).map(({ name }) => name);
    return columns.map((col) => ({
      value: col,
    }));
  }, [columnTypes]);

  const renderMapping = (acceptedFile: boolean) => {
    if (!acceptedFile) return;

    return selectMappings.map((option, index) => {
      return (
        <HStack key={index} marginY={2}>
          <Box width={200}>
            <CustomSelect
              selectOptions={CSVHeaders}
              mapping={option.value}
              onSelectChange={onSelectChange}
            />
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
    }
  }, [isOpen]);

  return (
    <Modal isOpen={isOpen} onClose={onClose}>
      <ModalOverlay />
      <ModalContent>
        <ModalHeader>Add rows from CSV</ModalHeader>
        <ModalCloseButton />
        <ModalBody>
          <CSVReaderComponent
            onUploadAccepted={({ data }: { data: string[][] }) => {
              preprocessCSV(data);
            }}
          >
            {renderMapping}
          </CSVReaderComponent>
          {hasErrors.length > 0 && (
            <Text color="red">Please check columns have valid formatting</Text>
          )}
        </ModalBody>

        <ModalFooter>
          <Button variant="ghost" mr={3} onClick={onClose}>
            Close
          </Button>
          <Button
            colorScheme="blue"
            isDisabled={
              recordEntries.length === 0 || !canUpload || hasErrors.length > 0
            }
            onClick={uploadCSVData}
            isLoading={uploadRecords.isLoading}
          >
            Upload
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}

interface CustomSelectProps {
  selectOptions: string[];
  mapping: string;
  onSelectChange: (value: string) => void;
}
const CustomSelect = ({
  selectOptions,
  onSelectChange,
  mapping,
}: CustomSelectProps) => {
  const [selectedValue, setSelectedValue] = useState("");
  const handleSelectChange = (event: ChangeEvent<HTMLSelectElement>) => {
    setSelectedValue(event.target.value);
    onSelectChange(event.target.value);
  };

  return (
    <Select
      placeholder="Select column"
      onChange={handleSelectChange}
      value={selectedValue}
    >
      {selectOptions.map((column, i) => (
        <option key={i} value={`${mapping}-${column}`}>
          {column}
        </option>
      ))}
      <option value={`${mapping}-empty`}>Set empty</option>
    </Select>
  );
};
