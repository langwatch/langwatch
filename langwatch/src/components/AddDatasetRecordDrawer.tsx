import type { CustomCellRendererProps } from "@ag-grid-community/react";
import { Link } from "@chakra-ui/next-js";
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
  Select,
  Text,
  useDisclosure,
  useToast,
} from "@chakra-ui/react";
import { nanoid } from "nanoid";
import { useEffect, useMemo, useState } from "react";
import { useForm, type SubmitHandler } from "react-hook-form";
import { useLocalStorage } from "usehooks-ts";
import { z } from "zod";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { datasetSpanSchema } from "~/server/tracer/types.generated";
import { api } from "~/utils/api";
import type {
  annotationScoreSchema,
  DatasetColumns,
  DatasetRecordEntry,
} from "../server/datasets/types";
import type {
  DatasetSpan,
  ElasticSearchEvaluation,
  ElasticSearchSpan,
} from "../server/tracer/types";
import {
  elasticSearchEvaluationsToEvaluations,
  getRAGInfo,
} from "../server/tracer/utils";
import { AddOrEditDatasetDrawer } from "./AddOrEditDatasetDrawer";
import { useDrawer } from "./CurrentDrawer";
import { HorizontalFormControl } from "./HorizontalFormControl";
import {
  DatasetGrid,
  HeaderCheckboxComponent,
  type DatasetColumnDef,
} from "./datasets/DatasetGrid";

type FormValues = {
  datasetId: string;
};

interface AddDatasetDrawerProps {
  onSuccess?: () => void;
  traceId?: string;
  selectedTraceIds?: string[];
}

export function AddDatasetRecordDrawerV2(props: AddDatasetDrawerProps) {
  const { project } = useOrganizationTeamProject();
  const createDatasetRecord = api.datasetRecord.create.useMutation();
  const toast = useToast();
  const { onOpen, onClose, isOpen } = useDisclosure();
  const { closeDrawer } = useDrawer();

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

  const traceIds = [
    ...(Array.isArray(props.selectedTraceIds)
      ? props.selectedTraceIds
      : [props.selectedTraceIds]),
    props?.traceId ?? "",
  ].filter(Boolean) as string[];

  const tracesWithSpans = api.traces.getTracesWithSpans.useQuery(
    {
      projectId: project?.id ?? "",
      traceIds: traceIds,
    },
    {
      enabled: !!project,
      refetchOnWindowFocus: false,
    }
  );

  const evaluationsObject = api.traces.getEvaluationsMultiple.useQuery(
    { projectId: project?.id ?? "", traceIds: traceIds },
    {
      enabled: !!project,
      refetchOnWindowFocus: false,
    }
  );

  const evaluations = useMemo(
    () => Object.values(evaluationsObject.data ?? {}).flat(),
    [evaluationsObject.data]
  );

  const annotationScores = api.annotation.getByTraceIds.useQuery(
    { projectId: project?.id ?? "", traceIds: traceIds },
    { enabled: !!project, refetchOnWindowFocus: false }
  );

  const getAnnotationScoreOptions = api.annotationScore.getAllActive.useQuery(
    { projectId: project?.id ?? "" },
    {
      enabled: !!project?.id,
      refetchOnWindowFocus: false,
    }
  );

  const idNameMap = useMemo(
    () =>
      getAnnotationScoreOptions?.data?.reduce(
        (map, obj) => {
          map[obj.id] = obj.name;
          return map;
        },
        {} as Record<string, string>
      ),
    [getAnnotationScoreOptions.data]
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

  const onCreateDatasetSuccess = ({ datasetId }: { datasetId: string }) => {
    onClose();
    void datasets.refetch().then(() => {
      setTimeout(() => {
        setValue("datasetId", datasetId);
      }, 100);
    });
  };

  const handleOnClose = () => {
    closeDrawer();
    reset({
      datasetId,
    });
  };

  const [editableRowData, setEditableRowData] = useState<DatasetRecordEntry[]>(
    []
  );
  const rowsToAdd = editableRowData.filter((row) => row.selected);
  const columnTypes = selectedDataset?.columnTypes as
    | DatasetColumns
    | undefined;

  const onSubmit: SubmitHandler<FormValues> = (_data) => {
    if (!selectedDataset || !project) return;

    const entries: DatasetRecordEntry[] = rowsToAdd.map(
      (row) =>
        Object.fromEntries(
          Object.entries(row)
            .filter(([key, _]) => key !== "selected")
            .map(([key, value]) => {
              const column = columnTypes?.find((column) => column.name === key);
              let entry: DatasetRecordEntry = value;
              if (column?.type !== "string") {
                try {
                  entry = JSON.parse(value as string);
                } catch {}
              }

              return [key, entry];
            })
        ) as DatasetRecordEntry
    );

    createDatasetRecord.mutate(
      {
        projectId: project.id ?? "",
        datasetId: datasetId,
        entries,
      },
      {
        onSuccess: () => {
          closeDrawer();
          toast({
            duration: 3000,
            isClosable: true,
            position: "top-right",
            title: "Succesfully added to dataset",
            status: "success",
            description: (
              <Link
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

  const getEvaluationArray = (
    data: ElasticSearchEvaluation[],
    traceId: string
  ) => {
    if (!Array.isArray(data)) {
      return [];
    }

    return elasticSearchEvaluationsToEvaluations(data)
      .filter(
        // TODO: fix this type assertion, evaluations should be included in the traces now, no need for trace_id
        (item) =>
          item.status === "processed" && (item as any).trace_id === traceId
      )
      .map((item) => {
        return {
          name: item.name,
          type: item.type,
          passed: item.passed,
          score: item.score,
        };
      });
  };

  const getAnnotationScoresArray = (
    data: z.infer<typeof annotationScoreSchema>[],
    idNameMap: Record<string, string>,
    traceId: string
  ) => {
    return data
      .filter((score) => score.traceId === traceId) // Filter out entries with matching traceId
      .flatMap((score) => {
        if (!("scoreOptions" in score)) return []; // Type guard
        return Object.entries(score.scoreOptions ?? {})
          .filter(([, option]) => option.value !== null)
          .map(([key, option]) => ({
            ...option,
            name: idNameMap?.[key] ?? "",
          }));
      });
  };

  const rowDataFromDataset = useMemo(() => {
    if (!selectedDataset || !tracesWithSpans.data) {
      return;
    }

    const rows: DatasetRecordEntry[] = [];

    for (const trace of tracesWithSpans.data) {
      const row: DatasetRecordEntry = {
        id: nanoid(),
        selected: true,
      };
      for (const {
        name,
        type,
      } of (selectedDataset.columnTypes as DatasetColumns) ?? []) {
        if (name === "input" && type === "string") {
          row[name] = trace.input?.value ?? "";
        } else if (name === "expected_output" && type === "string") {
          row[name] = trace.output?.value ?? "";
        } else if (type === "rag_contexts") {
          try {
            row[name] = JSON.stringify(
              getRAGInfo(trace.spans ?? []).contexts ?? []
            );
          } catch (e) {
            row[name] = JSON.stringify([]);
          }
        } else if (type === "spans") {
          row[name] = JSON.stringify(
            esSpansToDatasetSpans(trace.spans ?? []),
            null,
            2
          );
        } else if (name === "annotation_scores") {
          const annotationScoresArray = annotationScores.data
            ? getAnnotationScoresArray(
                annotationScores.data as z.infer<
                  typeof annotationScoreSchema
                >[],
                idNameMap ?? {},
                trace.trace_id
              )
            : [];
          row[name] = JSON.stringify(annotationScoresArray);
        } else if (type === "evaluations") {
          row[name] = JSON.stringify(
            getEvaluationArray(evaluations, trace.trace_id)
          );
        } else {
          row[name] = "";
        }
      }

      // One row per LLM entry
      if (
        ((selectedDataset.columnTypes as DatasetColumns) ?? []).some(
          ({ type }) => type === "chat_messages"
        )
      ) {
        const llmEntries = trace.spans?.filter((span) => span.type === "llm");
        // TODO: disable the row if the llm entry has no chat_message as input/output type
        for (const llmEntry of llmEntries ?? []) {
          const row_: DatasetRecordEntry = { ...row, id: nanoid() };

          for (const {
            name,
            type,
          } of (selectedDataset.columnTypes as DatasetColumns) ?? []) {
            if (name === "expected_llm_output" && type === "chat_messages") {
              row_[name] = llmEntry.output?.value ? llmEntry.output.value : "";
            } else if (type === "chat_messages") {
              row_[name] = llmEntry.input?.value ? llmEntry.input.value : "";
            }
          }
          rows.push(row_);
        }
      } else {
        rows.push(row);
      }
    }

    return rows;
  }, [
    selectedDataset,
    tracesWithSpans.data,
    annotationScores.data,
    idNameMap,
    evaluations,
  ]);

  useEffect(() => {
    if (!rowDataFromDataset) return;

    setEditableRowData(rowDataFromDataset);
  }, [rowDataFromDataset]);

  const columnDefs = useMemo(() => {
    if (!selectedDataset) {
      return [];
    }

    const headers: DatasetColumnDef[] = (
      (selectedDataset.columnTypes as DatasetColumns) ?? []
    ).map(({ name, type }) => ({
      headerName: name,
      field: name,
      type_: type,
      cellClass: "v-align",
      sortable: false,
    }));

    // Add row number column
    headers.unshift({
      headerName: " ",
      field: "selected",
      type_: "boolean",
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
      isOpen={true}
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
                      <option
                        key={index}
                        value={dataset.id}
                        selected={dataset.id === localStorageDatasetId}
                      >
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

            {selectedDataset && (
              <DatasetGrid
                columnDefs={columnDefs}
                rowData={rowDataFromDataset}
                onCellValueChanged={({
                  data,
                }: {
                  data: DatasetRecordEntry;
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
      <AddOrEditDatasetDrawer
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
    if (newArray[i].output?.value) {
      const outputObj = JSON.parse(newArray[i].output.value);
      newArray[i].output.value = outputObj;
    } else {
      newArray[i].output = { value: "", type: "json" };
    }
    if (newArray[i].input?.value) {
      const inputObj = JSON.parse(newArray[i].input.value);
      newArray[i].input.value = inputObj;
    } else {
      newArray[i].input = { value: "", type: "json" };
    }
  }
  try {
    return z.array(datasetSpanSchema).parse(newArray);
  } catch (e) {
    return newArray;
  }
};
