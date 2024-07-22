import { DownloadIcon } from "@chakra-ui/icons";
import {
  Box,
  Button,
  Card,
  CardBody,
  Container,
  HStack,
  Heading,
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
  VStack,
  useDisclosure,
  useToast,
} from "@chakra-ui/react";
import { type ColDef } from "@ag-grid-community/core";
import { useRouter } from "next/router";
import Parse from "papaparse";
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  useRef,
  type ChangeEvent,
} from "react";
import { ArrowRight, Play, Upload } from "react-feather";
import { useDrawer } from "~/components/CurrentDrawer";
import { DashboardLayout } from "~/components/DashboardLayout";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { api } from "~/utils/api";
import { schemaDisplayName } from "~/utils/datasets";
import { DatasetGrid } from "../../../components/datasets/DatasetGrid";
import { newDatasetEntriesSchema } from "~/server/datasets/types";
import {
  type datasetSpanSchema,
  type rAGChunkSchema,
} from "~/server/tracer/types.generated";

import { nanoid } from "nanoid";
import { formatFileSize, useCSVReader } from "react-papaparse";

export default function Dataset() {
  return (
    <DashboardLayout>
      <DatasetTable />
    </DashboardLayout>
  );
}

type RecordEntry = {
  id: string;
  input: string;
  expected_output: string;
  contexts?: string[] | typeof rAGChunkSchema;
  spans?: (typeof datasetSpanSchema)[];
  llm_input?: string;
  expected_llm_output?: string;
  comments?: string;
};

function DatasetTable() {
  const router = useRouter();
  const { project } = useOrganizationTeamProject();
  const dataSetId = router.query.id;

  const { openDrawer } = useDrawer();
  const { isOpen, onOpen, onClose } = useDisclosure();
  const { CSVReader } = useCSVReader();
  const [recordEntries, setRecordEntries] = useState<RecordEntry[]>([]);
  const [CSVHeaders, setCSVHeaders] = useState([]);
  const [hasErrors, setErrors] = useState<string[]>([]);
  const [csvUploaded, setCSVUploaded] = useState([]);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [canUpload, setCanUpload] = useState(false);
  const [savingStatus, setSavingStatus] = useState<"saving" | "saved" | "">("");

  const dataset = api.datasetRecord.getAll.useQuery(
    { projectId: project?.id ?? "", datasetId: dataSetId as string },
    {
      enabled: !!project,
      refetchOnWindowFocus: false,
    }
  );

  const uploadRecords = api.datasetRecord.create.useMutation();

  const columnDefs = useMemo(() => {
    if (!dataset.data) return [];

    const fieldToLabelMap: Record<string, string> = {
      input: "Input",
      expected_output: "Expected Output",
      contexts: "Contexts",
      spans: "Spans",
      llm_input: "LLM Input",
      expected_llm_output: "Expected LLM Output",
      comments: "Comments",
      annotation_scores: "Annotation Scores",
      evaluations: "Evaluations",
    };

    const headers: ColDef[] = dataset.data.columns.split(",").map((field) => ({
      headerName: fieldToLabelMap[field],
      field,
      cellClass: "v-align",
      sortable: false,
    }));

    // Add row number column
    headers.unshift({
      headerName: "#",
      valueGetter: "node.rowIndex + 1",
      width: 42,
      pinned: "left",
      sortable: false,
      filter: false,
      editable: false,
    });

    return headers;
  }, [dataset.data]);

  const rowData = useMemo(() => {
    if (!dataset.data) return;

    const columns = dataset.data.columns.split(",");
    return dataset.data.datasetRecords.map((record) => {
      const row: Record<string, any> = { id: record.id };
      columns.forEach((col) => {
        const value = (record.entry as any)[col];
        row[col] = typeof value === "object" ? JSON.stringify(value) : value;
      });
      return row;
    });
  }, [dataset.data]);

  const updateDatasetRecord = api.datasetRecord.update.useMutation();
  // const deleteDatasetRecord = api.datasetRecord.delete.useMutation();

  const toast = useToast();

  const timeoutRef = useRef<NodeJS.Timeout>(null);

  const onCellValueChanged = useCallback(
    (params: any) => {
      setSavingStatus("saving");
      const updatedRecord = params.data;
      updateDatasetRecord.mutate(
        {
          projectId: project?.id ?? "",
          datasetId: dataSetId as string,
          recordId: params.data.id,
          updatedRecord,
        },
        {
          onSuccess: () => {
            setSavingStatus("saved");
            if (timeoutRef.current) {
              clearInterval(timeoutRef.current);
            }
            //@ts-ignore
            timeoutRef.current = setTimeout(() => {
              setSavingStatus("");
            }, 3000);
          },
          onError: () => {
            toast({
              title: "Error updating record.",
              description: "Changes will be reverted, please try again",
              status: "error",
              duration: 5000,
              isClosable: true,
            });
            void dataset.refetch();
            setSavingStatus("");
          },
        }
      );
    },
    [updateDatasetRecord, project?.id, dataSetId, toast, dataset]
  );

  const preprocessCSV = (csv: any) => {
    setCSVHeaders(csv.slice(0, 1)[0]);
    setCSVUploaded(csv);
  };

  function safeGetRowValue(row: any[], headers: string[], key: string): string {
    const index = headers.indexOf(key);
    return index !== -1 ? row[index] : "";
  }

  const parseJSONField = (
    row: any[],
    headers: string[],
    key: string,
    field: string
  ): any => {
    if (key === "") return;
    const rawValue = safeGetRowValue(row, headers, key);

    try {
      if (rawValue) {
        const parsedValue = JSON.parse(rawValue);
        setErrors((prevErrors) =>
          prevErrors.filter((error) => error !== field)
        );
        return parsedValue;
      } else {
        return undefined;
      }
    } catch (error) {
      setErrors((prevErrors) => {
        if (prevErrors.includes(field)) return prevErrors;
        return [...prevErrors, field];
      });
      return undefined;
    }
  };

  const setupRecordsUpload = (mappings: Record<string, string>) => {
    const records: RecordEntry[] = [];

    csvUploaded.slice(1).forEach((row: any) => {
      const entries: RecordEntry = {
        id: nanoid(),
        input: safeGetRowValue(row, CSVHeaders, mappings.input ?? ""),
        expected_output: safeGetRowValue(
          row,
          CSVHeaders,
          mappings.expected_output ?? ""
        ),
        comments: safeGetRowValue(row, CSVHeaders, mappings.comments ?? ""),
        contexts: parseJSONField(
          row,
          CSVHeaders,
          mappings.contexts ?? "",
          "contexts"
        ),
        spans: parseJSONField(row, CSVHeaders, mappings.spans ?? "", "spans"),
        llm_input: parseJSONField(
          row,
          CSVHeaders,
          mappings.llm_input ?? "",
          "llm_input"
        ),
        expected_llm_output: parseJSONField(
          row,
          CSVHeaders,
          mappings.expected_llm_output ?? "",
          "expected_llm_output"
        ),
      };

      records.push(entries);
    });

    setRecordEntries(records);
    preprocessCSV(csvUploaded);
  };

  const isMappingsComplete = useCallback(() => {
    const columns = dataset.data?.columns.split(",") ?? [];
    return columns.every((column) => Object.keys(mapping).includes(column));
  }, [dataset.data?.columns, mapping]);

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
        entries: recordEntries,
        schema: dataset.data?.schema as
          | "ONE_MESSAGE_PER_ROW"
          | "ONE_LLM_CALL_PER_ROW",
      });
    } catch (error) {
      toast({
        title: "Error processing CSV",
        description: "The CSV file does not match the expected format.",
        status: "error",
        duration: 5000,
        isClosable: true,
      });

      return;
    }

    uploadRecords.mutate(
      {
        projectId: project?.id ?? "",
        datasetId: dataSetId as string,
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

  const downloadCSV = () => {
    const columns = dataset.data?.columns.split(",") ?? [];
    const csvData =
      dataset.data?.datasetRecords.map((record) =>
        columns.map((col) => {
          const value = (record.entry as any)[col];
          return typeof value === "object" ? JSON.stringify(value) : value;
        })
      ) ?? [];

    const csv = Parse.unparse({
      fields: columns,
      data: csvData,
    });

    const url = window.URL.createObjectURL(new Blob([csv]));

    const link = document.createElement("a");
    link.href = url;
    const fileName = `${dataset.data?.name}.csv`;
    link.setAttribute("download", fileName);
    document.body.appendChild(link);
    link.click();
    link.remove();
  };

  const [zoneHover, setZoneHover] = useState(false);

  const selectMappings = useMemo(() => {
    const columns = dataset.data?.columns.split(",") ?? [];
    return columns.map((col) => ({
      value: col,
    }));
  }, [dataset.data]);

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

  const openCSVUploader = () => {
    setRecordEntries([]);
    setMapping({});
    setCSVHeaders([]);
    setCSVUploaded([]);
    setErrors([]);
    onOpen();
  };

  return (
    <>
      <Container maxW={"calc(100vw - 200px)"} padding={6} marginTop={8}>
        <HStack width="full" verticalAlign={"middle"} paddingBottom={6}>
          <Heading as={"h1"} size="lg">
            Dataset {`- ${dataset.data?.name ?? ""}`}
          </Heading>
          <Text
            whiteSpace="nowrap"
            bg="gray.200"
            paddingX="2"
            paddingY="1"
            borderRadius="lg"
            fontSize={12}
            marginLeft={4}
          >
            {dataset.data ? schemaDisplayName(dataset.data?.schema) : ""}
          </Text>
          <HStack padding={2}>
            <Text fontSize={"12px"} color="gray.400">
              {savingStatus === "saving"
                ? "Saving..."
                : savingStatus === "saved"
                ? "Saved"
                : ""}
            </Text>
          </HStack>
          <Spacer />
          <Button
            onClick={() => openCSVUploader()}
            rightIcon={<Upload height={17} width={17} strokeWidth={2.5} />}
          >
            Upload CSV
          </Button>
          <Button
            colorScheme="black"
            minWidth="fit-content"
            variant="ghost"
            onClick={() => dataset.data?.schema && downloadCSV()}
          >
            Export <DownloadIcon marginLeft={2} />
          </Button>
          <Button
            colorScheme="blue"
            onClick={() => {
              openDrawer("batchEvaluation", {
                datasetSlug: dataset.data?.slug,
              });
            }}
            minWidth="fit-content"
            leftIcon={<Play height={16} />}
          >
            Batch Evaluation
          </Button>
        </HStack>
        <Card>
          <CardBody padding={0}>
            <DatasetGrid
              columnDefs={columnDefs}
              rowData={rowData}
              onCellValueChanged={onCellValueChanged}
            />
          </CardBody>
        </Card>
        <Modal isOpen={isOpen} onClose={onClose}>
          <ModalOverlay />
          <ModalContent>
            <ModalHeader>Upload CSV</ModalHeader>
            <ModalCloseButton />
            <ModalBody>
              <CSVReader
                onUploadAccepted={(results: any) => {
                  preprocessCSV(results.data);
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
                }: any) => (
                  <>
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
                    {renderMapping(acceptedFile)}
                  </>
                )}
              </CSVReader>
              {hasErrors.length > 0 && (
                <Text color="red">
                  Please check columns have valid formatting
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
                  recordEntries.length === 0 ||
                  !canUpload ||
                  hasErrors.length > 0
                }
                onClick={uploadCSVData}
                isLoading={uploadRecords.isLoading}
              >
                Upload
              </Button>
            </ModalFooter>
          </ModalContent>
        </Modal>
      </Container>
    </>
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
