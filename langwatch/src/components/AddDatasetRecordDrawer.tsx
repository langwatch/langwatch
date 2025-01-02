import { Link } from "@chakra-ui/next-js";
import {
  Button,
  Drawer,
  DrawerBody,
  DrawerCloseButton,
  DrawerContent,
  DrawerHeader,
  HStack,
  Text,
  useDisclosure,
  useToast,
  VStack,
} from "@chakra-ui/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useForm, type SubmitHandler } from "react-hook-form";
import { useLocalStorage } from "usehooks-ts";
import { type z } from "zod";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { api } from "~/utils/api";
import type {
  annotationScoreSchema,
  DatasetColumns,
  DatasetRecordEntry,
} from "../server/datasets/types";
import type { ElasticSearchEvaluation } from "../server/tracer/types";
import { elasticSearchEvaluationsToEvaluations } from "../server/tracer/utils";
import { AddOrEditDatasetDrawer } from "./AddOrEditDatasetDrawer";
import { useDrawer } from "./CurrentDrawer";
import { DatasetMappingPreview } from "./datasets/DatasetMappingPreview";
import { DatasetSelector } from "./datasets/DatasetSelector";

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
  const editDataset = useDisclosure();
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
    editDataset.onClose();
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
          label: item.label,
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

  const [rowDataFromDataset, setRowDataFromDataset] = useState<
    DatasetRecordEntry[]
  >([]);

  useEffect(() => {
    if (!rowDataFromDataset) return;

    setEditableRowData(rowDataFromDataset);
  }, [rowDataFromDataset]);

  const scrollRef = useRef<HTMLDivElement>(null);
  const [atBottom, setAtBottom] = useState(false);

  useEffect(() => {
    if (!scrollRef.current) return;

    setAtBottom(
      (scrollRef.current.scrollTop ?? 0) >=
        (scrollRef.current.scrollHeight ?? 0) -
          (scrollRef.current.clientHeight ?? 0)
    );
  }, [rowDataFromDataset]);

  return (
    <Drawer
      isOpen={true}
      placement="right"
      size="xl"
      onClose={handleOnClose}
      blockScrollOnMount={true}
    >
      <DrawerContent
        maxWidth="1400px"
        overflow="scroll"
        ref={scrollRef}
        onScroll={() =>
          setAtBottom(
            (scrollRef.current?.scrollTop ?? 0) >=
              (scrollRef.current?.scrollHeight ?? 0) -
                (scrollRef.current?.clientHeight ?? 0)
          )
        }
      >
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
        <DrawerBody overflow="visible" paddingX={0}>
          {/* eslint-disable-next-line @typescript-eslint/no-misused-promises */}
          <form onSubmit={handleSubmit(onSubmit)}>
            <VStack paddingX={6}>
              <DatasetSelector
                datasets={datasets.data}
                localStorageDatasetId={localStorageDatasetId}
                register={register}
                errors={errors}
                setValue={setValue}
                onCreateNew={editDataset.onOpen}
              />
              {selectedDataset && (
                <DatasetMappingPreview
                  traces={tracesWithSpans.data ?? []}
                  columnTypes={selectedDataset.columnTypes as DatasetColumns}
                  rowData={rowDataFromDataset}
                  selectedDataset={selectedDataset}
                  onEditColumns={editDataset.onOpen}
                  onRowDataChange={setRowDataFromDataset}
                />
              )}
            </VStack>

            <HStack
              width="full"
              justifyContent="flex-end"
              position="sticky"
              bottom={0}
              paddingBottom={4}
              background="white"
              transition="box-shadow 0.3s ease-in-out"
              boxShadow={atBottom ? "none" : "0 -2px 5px rgba(0, 0, 0, 0.1)"}
              paddingX={6}
            >
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
            </HStack>
          </form>
        </DrawerBody>
      </DrawerContent>
      <AddOrEditDatasetDrawer
        datasetToSave={
          selectedDataset
            ? {
                datasetId,
                name: selectedDataset?.name ?? "",
                datasetRecords: undefined,
                columnTypes:
                  (selectedDataset?.columnTypes as DatasetColumns) ?? [],
              }
            : undefined
        }
        isOpen={editDataset.isOpen}
        onClose={editDataset.onClose}
        onSuccess={onCreateDatasetSuccess}
      />
    </Drawer>
  );
}
