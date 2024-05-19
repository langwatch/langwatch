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
} from "@chakra-ui/react";
import { type DatabaseSchema, type Dataset } from "@prisma/client";
import { useRouter } from "next/router";
import Parse from "papaparse";
import { Play } from "react-feather";
import { useDrawer } from "~/components/CurrentDrawer";
import { DashboardLayout } from "~/components/DashboardLayout";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { api } from "~/utils/api";
import { schemaDisplayName } from "~/utils/datasets";
import { useCallback, useMemo } from "react";
import { DatasetGrid } from "../../../components/datasets/DatasetGrid";
import { type ColDef } from "ag-grid-community";

export default function Dataset() {
  return (
    <DashboardLayout>
      <DatasetTable />
    </DashboardLayout>
  );
}

function DatasetTable() {
  const router = useRouter();
  const { project } = useOrganizationTeamProject();
  const dataSetId = router.query.id;
  const { openDrawer } = useDrawer();

  const dataset = api.datasetRecord.getAll.useQuery(
    { projectId: project?.id ?? "", datasetId: dataSetId as string },
    {
      enabled: !!project,
      refetchOnWindowFocus: false,
    }
  );

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

  const downloadCSV = (schema: DatabaseSchema) => {
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
            colorScheme="black"
            minWidth="fit-content"
            variant="ghost"
            onClick={() =>
              dataset.data?.schema && downloadCSV(dataset.data.schema)
            }
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
      </Container>
    </>
  );
}
