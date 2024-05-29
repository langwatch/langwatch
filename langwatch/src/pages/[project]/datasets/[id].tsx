import { DownloadIcon } from "@chakra-ui/icons";
import {
  Button,
  Card,
  CardBody,
  Container,
  HStack,
  Heading,
  Spacer,
  Text,
  useToast,
  Modal,
  ModalOverlay,
  ModalContent,
  ModalHeader,
  ModalFooter,
  ModalBody,
  ModalCloseButton,
  useDisclosure,
  Select,
  Grid,
  GridItem,
  Box,
  VStack,
} from "@chakra-ui/react";
import { type Dataset } from "@prisma/client";
import { useRouter } from "next/router";
import Parse from "papaparse";
import { Play, Upload, ArrowRight } from "react-feather";
import { useDrawer } from "~/components/CurrentDrawer";
import { DashboardLayout } from "~/components/DashboardLayout";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { api } from "~/utils/api";
import { schemaDisplayName } from "~/utils/datasets";
import {
  useCallback,
  useMemo,
  useState,
  type ChangeEvent,
  useEffect,
} from "react";
import { DatasetGrid } from "../../../components/datasets/DatasetGrid";
import { type ColDef } from "ag-grid-community";
import {
  chatMessageSchema,
  type datasetSpanSchema,
} from "~/server/tracer/types.generated";

import {
  useCSVReader,
  lightenDarkenColor,
  formatFileSize,
} from "react-papaparse";
import { nanoid } from "nanoid";

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
  contexts?: string[];
  spans?: (typeof datasetSpanSchema)[];
  llm_input?: string;
  expected_llm_output?: string;
};

function DatasetTable() {
  const router = useRouter();
  const { project } = useOrganizationTeamProject();
  const dataSetId = router.query.id;
  const { openDrawer } = useDrawer();
  const { isOpen, onOpen, onClose } = useDisclosure();
  const { CSVReader } = useCSVReader();

  const [recordEntries, setRecordEntries] = useState([]);
  const [CSVHeaders, setCSVHeaders] = useState([]);

  const [csvUploaded, setCSVUploaded] = useState([]);
  const [mapping, setMapping] = useState<string[]>([]);
  const [canUpload, setCanUpload] = useState(false);
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

  const toast = useToast();

  const onCellValueChanged = useCallback(
    (params: any) => {
      const updatedRecord = params.data;
      updateDatasetRecord.mutate(
        {
          projectId: project?.id ?? "",
          datasetId: dataSetId as string,
          recordId: params.data.id,
          updatedRecord,
        },
        {
          onError: () => {
            toast({
              title: "Error updating record.",
              description: "Changes will be reverted, please try again",
              status: "error",
              duration: 5000,
              isClosable: true,
            });
            void dataset.refetch();
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

  const setupRecordsUpload = (mappings: string[]) => {
    const records: RecordEntry[] = [];

    csvUploaded.slice(1).forEach((row: any) => {
      const entries: RecordEntry = {
        id: nanoid(),
        input: row[mappings.indexOf("input")],
        expected_output: row[mappings.indexOf("expected_output")],
        contexts: row[mappings.indexOf("contexts")],
        spans: row[mappings.indexOf("spans")],
        llm_input: row[mappings.indexOf("llm_input")]
          ? JSON.parse(row[mappings.indexOf("llm_input")])
          : undefined,
        expected_llm_output: row[mappings.indexOf("expected_llm_output")]
          ? JSON.parse(row[mappings.indexOf("expected_llm_output")])
          : undefined,
      };
      records.push(entries);
    });

    setRecordEntries(records);
    preprocessCSV(csvUploaded);
  };

  const isMappingsComplete = useCallback(() => {
    const columns = dataset.data?.columns.split(",") ?? [];
    return columns.every((column) => mapping.includes(column));
  }, [dataset.data?.columns, mapping]);

  useEffect(() => {
    setCanUpload(isMappingsComplete());
  }, [isMappingsComplete]);

  const onSelectChange = (value: string) => {
    const [field, index] = value.split("-");
    const numericIndex = parseInt(index, 10);
    const newMapping: string[] = [...mapping]; // Explicitly define as string array and use spread to copy existing mappings
    newMapping[numericIndex] = field ?? ""; // Provide a default empty string if field is undefined
    console.log(newMapping);
    setMapping(newMapping);
    setupRecordsUpload(newMapping);

    return newMapping;
  };

  const uploadCSVData = () => {
    console.log(recordEntries);

    let test = {
      projectId: project?.id ?? "",
      datasetId: dataSetId as string,
      entries: recordEntries,
      schema: dataset.data?.schema ?? "ONE_MESSAGE_PER_ROW",
    };

    console.log(test);

    uploadRecords.mutate(
      {
        projectId: project?.id ?? "",
        datasetId: dataSetId as string,
        entries: recordEntries,
        schema: dataset.data?.schema ?? "ONE_MESSAGE_PER_ROW",
      },
      {
        onSuccess: () => {
          void dataset.refetch();
          setRecordEntries([]);
          setMapping([]);
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

  const selectOptions = useMemo(() => {
    const columns = dataset.data?.columns.split(",") ?? [];
    return columns.map((col) => ({
      label: col,
      value: col,
    }));
  }, [dataset.data]);

  const renderMapping = () => {
    return (CSVHeaders ?? []).map((header, index) => {
      return (
        <HStack key={index} marginY={2}>
          <Text>{header}</Text>
          <Spacer />
          <ArrowRight />
          <Box width={200}>
            <CustomSelect
              selectOptions={selectOptions}
              index={index}
              onSelectChange={onSelectChange}
            />
          </Box>
        </HStack>
      );
    });
  };

  const openCSVUploader = () => {
    setRecordEntries([]);
    setMapping([]);
    setCSVHeaders([]);
    setCSVUploaded([]);
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
          <Spacer />
          <Button
            onClick={() => openCSVUploader()}
            rightIcon={<Upload height={20} />}
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
                  console.log("---------------------------");
                  console.log(results);
                  preprocessCSV(results.data);
                  console.log("---------------------------");
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
                              <Remove
                                onClick={() => {
                                  setRecordEntries([]);
                                  setCSVUploaded([]);
                                  setCSVHeaders([]);
                                  setMapping([]);
                                }}
                              />
                            </Box>
                          </Box>
                        </>
                      ) : (
                        "Drop CSV file here or click to upload"
                      )}
                    </Box>
                  </>
                )}
              </CSVReader>

              {renderMapping()}
            </ModalBody>

            <ModalFooter>
              <Button variant="ghost" mr={3} onClick={onClose}>
                Close
              </Button>
              <Button
                colorScheme="blue"
                isDisabled={recordEntries.length === 0 || !canUpload}
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
  selectOptions: { label: string; value: string }[];
  index: number;
  onSelectChange: (value: string) => void;
}
const CustomSelect = ({
  selectOptions,
  index,
  onSelectChange,
}: CustomSelectProps) => {
  const [selectedValue, setSelectedValue] = useState("");
  const handleSelectChange = (event: ChangeEvent<HTMLSelectElement>) => {
    setSelectedValue(event.target.value);
    onSelectChange(event.target.value);
  };

  return (
    <Select
      placeholder="Select option"
      onChange={handleSelectChange}
      value={selectedValue}
    >
      {selectOptions.map((option, i) => (
        <option key={i} value={`${option.value}-${index}`}>
          {option.label}
        </option>
      ))}
    </Select>
  );
};
