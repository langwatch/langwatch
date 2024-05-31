import {
  Button,
  Checkbox,
  Drawer,
  DrawerBody,
  DrawerCloseButton,
  DrawerContent,
  DrawerHeader,
  FormErrorMessage,
  HStack,
  Link,
  Select,
  Tag,
  Text,
  useDisclosure,
  useToast
} from "@chakra-ui/react";
import { type ColDef } from "ag-grid-community";
import type { CustomCellRendererProps } from "ag-grid-react";
import { nanoid } from "nanoid";
import NextLink from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useForm, type SubmitHandler } from "react-hook-form";
import { useLocalStorage } from "usehooks-ts";
import { z } from "zod";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { datasetSpanSchema } from "~/server/tracer/types.generated";
import { api } from "~/utils/api";
import { schemaDisplayName } from "~/utils/datasets";
import type {
  FlattenStringifiedDatasetEntry,
  newDatasetEntriesSchema,
} from "../server/datasets/types";
import type { DatasetSpan, ElasticSearchSpan } from "../server/tracer/types";
import { getRAGInfo } from "../server/tracer/utils";
import { AddDatasetDrawer } from "./AddDatasetDrawer";
import { HorizontalFormControl } from "./HorizontalFormControl";
import { DatasetGrid } from "./datasets/DatasetGrid";

type FormValues = {
  datasetId: string;
};

interface AddDatasetDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: () => void;
  traceId?: string;
  selectedTraceIds?: string[];
}

export function AddDatasetRecordDrawerV2(props: AddDatasetDrawerProps) {
  const { project } = useOrganizationTeamProject();
  const createDatasetRecord = api.datasetRecord.create.useMutation();
  const toast = useToast();
  const { onOpen, onClose, isOpen } = useDisclosure();

  const [localStorageDatasetId, setLocalStorageDatasetId] =
    useLocalStorage<string>("selectedDatasetId", "");
  const {
    register,
    handleSubmit,
    reset,
    watch,
    formState: { errors },
    setValue,
  } = useForm<FormValues>({
    defaultValues: {
      datasetId: localStorageDatasetId,
    },
  });

  const tracesWithSpans = api.traces.getTracesWithSpans.useQuery(
    {
      projectId: project?.id ?? "",
      traceIds: props?.selectedTraceIds ?? [props?.traceId ?? ""],
    },
    {
      enabled: !!project,
      refetchOnWindowFocus: false,
    }
  );

  const datasets = api.dataset.getAll.useQuery(
    { projectId: project?.id ?? "" },
    { enabled: !!project, refetchOnWindowFocus: false }
  );

  const datasetId = watch("datasetId");
  const selectedDataset = datasets.data?.find(
    (dataset) => dataset.id === datasetId
  );

  useEffect(() => {
    if (datasetId) {
      setLocalStorageDatasetId(datasetId);
    }
  }, [datasetId, setLocalStorageDatasetId]);

  useEffect(() => {
    if (
      datasetId &&
      datasets.data &&
      !datasets.data.find((dataset) => dataset.id === datasetId)
    ) {
      setValue("datasetId", "");
    }
  }, [datasetId, datasets.data, setValue]);

  const onCreateDatasetSuccess = (datasetId: string) => {
    onClose();
    void datasets.refetch().then(() => {
      setTimeout(() => {
        setValue("datasetId", datasetId);
      }, 100);
    });
  };

  const handleOnClose = () => {
    props.onClose();
    reset({
      datasetId,
    });
  };

  const [editableRowData, setEditableRowData] = useState<
    FlattenStringifiedDatasetEntry[]
  >([]);
  const rowsToAdd = editableRowData.filter((row) => row.selected);

  const onSubmit: SubmitHandler<FormValues> = (_data) => {
    if (!selectedDataset || !project) return;

    const schemaAndEntries:
      | z.infer<typeof newDatasetEntriesSchema>
      | undefined =
      selectedDataset.schema === "ONE_MESSAGE_PER_ROW"
        ? {
            schema: selectedDataset.schema,
            entries: rowsToAdd.map((row) => ({
              id: row.id,
              input: row.input,
              expected_output: row.expected_output,
              spans:
                row.spans !== undefined ? JSON.parse(row.spans) : undefined,
              contexts:
                row.contexts !== undefined
                  ? JSON.parse(row.contexts)
                  : undefined,
              comments: row.comments,
            })),
          }
        : selectedDataset.schema === "ONE_LLM_CALL_PER_ROW"
        ? {
            schema: selectedDataset.schema,
            entries: rowsToAdd.map((row) => ({
              id: row.id,
              llm_input:
                row.llm_input !== undefined
                  ? JSON.parse(row.llm_input)
                  : undefined,
              expected_llm_output:
                row.expected_llm_output !== undefined
                  ? JSON.parse(row.expected_llm_output)
                  : undefined,
              comments: row.comments,
            })),
          }
        : undefined;

    if (!schemaAndEntries) {
      return;
    }

    createDatasetRecord.mutate(
      {
        projectId: project.id ?? "",
        datasetId: datasetId,
        ...schemaAndEntries,
      },
      {
        onSuccess: () => {
          props.onClose();
          toast({
            duration: 3000,
            isClosable: true,
            position: "top-right",
            title: "Succesfully added to dataset",
            status: "success",
            description: (
              <Link
                as={NextLink}
                colorScheme="white"
                textDecoration={"underline"}
                href={`/${project?.slug}/datasets/${datasetId}`}
              >
                View the dataset
              </Link>
            ),
          });
        },
        onError: () => {
          toast({
            title: "Failed to add to the dataset",
            description:
              "Please check if the rows were not already inserted in the dataset",
            status: "error",
            duration: 5000,
            isClosable: true,
            position: "top-right",
          });
        },
      }
    );
  };

  const rowDataFromDataset = useMemo(() => {
    if (!selectedDataset || !tracesWithSpans.data) {
      return;
    }

    const rows: FlattenStringifiedDatasetEntry[] = [];
    const columns = selectedDataset.columns.split(",");

    if (selectedDataset.schema === "ONE_MESSAGE_PER_ROW") {
      for (const trace of tracesWithSpans.data) {
        const row: FlattenStringifiedDatasetEntry = {
          id: nanoid(),
          selected: true,
        };

        if (columns.includes("input")) {
          row.input = trace.input.value;
        }
        if (columns.includes("expected_output")) {
          row.expected_output = trace.output?.value ?? "";
        }
        if (columns.includes("contexts")) {
          try {
            row.contexts = JSON.stringify(
              getRAGInfo(trace.spans ?? []).contexts ?? []
            );
          } catch (e) {
            row.contexts = JSON.stringify([]);
          }
        }
        if (columns.includes("spans")) {
          row.spans = JSON.stringify(
            esSpansToDatasetSpans(trace.spans ?? []),
            null,
            2
          );
        }
        rows.push(row);
      }
    }

    if (selectedDataset.schema === "ONE_LLM_CALL_PER_ROW") {
      for (const trace of tracesWithSpans.data) {
        const llmEntries = trace.spans?.filter((span) => span.type === "llm");
        // TODO: disable the row if the llm entry has no chat_message as input/output type
        for (const llmEntry of llmEntries ?? []) {
          const row: FlattenStringifiedDatasetEntry = {
            id: nanoid(),
            selected: true,
          };

          if (
            columns.includes("llm_input") &&
            llmEntry.input?.type === "chat_messages"
          ) {
            row.llm_input = llmEntry.input.value;
          }
          if (
            columns.includes("expected_llm_output") &&
            llmEntry.outputs[0]?.type === "chat_messages"
          ) {
            row.expected_llm_output = llmEntry.outputs[0].value;
          }

          rows.push(row);
        }
      }
    }

    return rows;
  }, [selectedDataset, tracesWithSpans.data]);

  useEffect(() => {
    if (!rowDataFromDataset) return;

    setEditableRowData(rowDataFromDataset);
  }, [rowDataFromDataset]);

  const columnDefs = useMemo(() => {
    if (!selectedDataset) {
      return [];
    }

    const fieldToLabelMap: Record<string, string> = {
      input: "Input",
      expected_output: "Expected Output",
      contexts: "Contexts",
      spans: "Spans",
      llm_input: "LLM Input",
      expected_llm_output: "Expected LLM Output",
      comments: "Comments",
    };

    const headers: ColDef[] = selectedDataset.columns
      .split(",")
      .map((field) => ({
        headerName: fieldToLabelMap[field],
        field,
        cellClass: "v-align",
        sortable: false,
      }));

    // Add row number column
    headers.unshift({
      headerName: " ",
      field: "selected",
      width: 46,
      pinned: "left",
      sortable: false,
      filter: false,
      enableCellChangeFlash: false,
      headerComponent: HeaderCheckboxComponent,
      cellRenderer: (props: CustomCellRendererProps) => (
        <Checkbox
          marginLeft="3px"
          {...props}
          isChecked={props.value}
          onChange={(e) => props.setValue?.(e.target.checked)}
        />
      ),
    });

    return headers;
  }, [selectedDataset]);

  return (
    <Drawer
      isOpen={props.isOpen}
      placement="right"
      size="xl"
      onClose={handleOnClose}
      blockScrollOnMount={false}
    >
      <DrawerContent maxWidth="1400px">
        <DrawerHeader>
          <HStack>
            <DrawerCloseButton />
          </HStack>
          <HStack>
            <Text paddingTop={5} fontSize="3xl">
              Add to Dataset
            </Text>
          </HStack>
        </DrawerHeader>
        <DrawerBody overflow="scroll">
          {/* eslint-disable-next-line @typescript-eslint/no-misused-promises */}
          <form onSubmit={handleSubmit(onSubmit)}>
            <HorizontalFormControl
              label="Dataset"
              helper="Add to an existing dataset or create a new one"
              isInvalid={!!errors.datasetId}
            >
              {/* TODO: keep last selection on localstorage */}
              <Select
                {...register("datasetId", { required: "Dataset is required" })}
              >
                <option value={""}>Select Dataset</option>
                {datasets.data
                  ? datasets.data?.map((dataset, index) => (
                      <option key={index} value={dataset.id}>
                        {dataset.name}
                      </option>
                    ))
                  : null}
              </Select>
              {errors.datasetId && (
                <FormErrorMessage>{errors.datasetId.message}</FormErrorMessage>
              )}
              <Button
                colorScheme="blue"
                onClick={() => {
                  onOpen();
                }}
                minWidth="fit-content"
                variant="link"
                marginTop={2}
                fontWeight={"normal"}
              >
                + Create New
              </Button>
            </HorizontalFormControl>

            {selectedDataset?.schema ? (
              <HStack align={"start"} paddingY={4}>
                <Text>Dataset Schema:</Text>
                <Tag>{schemaDisplayName(selectedDataset?.schema)}</Tag>
              </HStack>
            ) : null}

            {selectedDataset && (
              <DatasetGrid
                columnDefs={columnDefs}
                rowData={rowDataFromDataset}
                onCellValueChanged={({
                  data,
                }: {
                  data: FlattenStringifiedDatasetEntry;
                }) => {
                  setEditableRowData((rowData) =>
                    rowData.map((row) => (row.id === data.id ? data : row))
                  );
                }}
              />
            )}

            <Button
              type="submit"
              colorScheme="blue"
              marginTop={6}
              marginBottom={4}
              isLoading={createDatasetRecord.isLoading}
              isDisabled={
                !selectedDataset ||
                !tracesWithSpans.data ||
                rowsToAdd.length === 0
              }
            >
              Add{" "}
              {selectedDataset && tracesWithSpans.data
                ? `${rowsToAdd.length} ${
                    rowsToAdd.length == 1 ? "row" : "rows"
                  }`
                : ""}{" "}
              to dataset
            </Button>
          </form>
        </DrawerBody>
      </DrawerContent>
      <AddDatasetDrawer
        isOpen={isOpen}
        onClose={onClose}
        onSuccess={onCreateDatasetSuccess}
      />
    </Drawer>
  );
}

const esSpansToDatasetSpans = (spans: ElasticSearchSpan[]): DatasetSpan[] => {
  const newArray = JSON.parse(JSON.stringify(spans));
  for (let i = 0; i < spans.length; i++) {
    if (newArray[i].outputs[0]?.value) {
      const outputObj = JSON.parse(newArray[i].outputs[0].value);
      newArray[i].outputs[0].value = outputObj;
    } else {
      newArray[i].outputs.push({ value: "", type: "json" });
    }
    const inputObj = JSON.parse(newArray[i].input.value);
    newArray[i].input.value = inputObj;
  }
  return z.array(datasetSpanSchema).parse(newArray);
};

function HeaderCheckboxComponent(props: CustomCellRendererProps) {
  const [checkboxState, setCheckboxState] = useState<
    "checked" | "unchecked" | "indeterminate"
  >("unchecked");

  useEffect(() => {
    const updateAllChecked = () => {
      let allChecked = props.api.getDisplayedRowCount() > 0;
      let allUnchecked = true;
      props.api.forEachNode((node) => {
        if (!node.data.selected) {
          allChecked = false;
        } else {
          allUnchecked = false;
        }
      });
      setCheckboxState(
        allChecked ? "checked" : allUnchecked ? "unchecked" : "indeterminate"
      );
    };

    props.api.addEventListener("cellValueChanged", updateAllChecked);

    // Initial check
    updateAllChecked();

    return () => {
      props.api.removeEventListener("cellValueChanged", updateAllChecked);
    };
  }, [props.api]);

  return (
    <Checkbox
      marginLeft="3px"
      isChecked={checkboxState === "checked"}
      isIndeterminate={checkboxState === "indeterminate"}
      onChange={(e) => {
        const isChecked = e.target.checked;
        props.api.forEachNode((node) => {
          node.setDataValue("selected", isChecked);
        });
      }}
    />
  );
}
