import { DownloadIcon } from "@chakra-ui/icons";
import {
  Button,
  Card,
  CardBody,
  Container,
  HStack,
  Heading,
  Skeleton,
  Spacer,
  Text,
  useToast,
} from "@chakra-ui/react";
import { DatabaseSchema, type DatasetRecord } from "@prisma/client";
import { useRouter } from "next/router";
import Parse from "papaparse";
import { Play } from "react-feather";
import { useDrawer } from "~/components/CurrentDrawer";
import { DashboardLayout } from "~/components/DashboardLayout";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { api } from "~/utils/api";
import { schemaDisplayName } from "~/utils/datasets";
import { useCallback, useMemo } from "react";
import {
  DatasetGrid,
  JSONCellRenderer,
} from "../../../components/datasets/DatasetGrid";
import { type ColDef } from "ag-grid-community";
import { MultilineJSONCellEditor } from "../../../components/datasets/MultilineJSONCellEditor";

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

  const getHeaders = (schema: DatabaseSchema): ColDef[] => {
    const fieldToLabelMap: Record<string, string> = {
      input: "Input",
      expected_output: "Expected Output",
      spans: "Spans",
    };

    let fields: string[] = [];
    if (
      schema === DatabaseSchema.STRING_I_O ||
      schema === DatabaseSchema.LLM_CHAT_CALL
    ) {
      fields = ["input", "expected_output"];
    } else if (schema === DatabaseSchema.FULL_TRACE) {
      fields = ["input", "expected_output", "spans"];
    }

    const headers: ColDef[] = fields.map((field) => ({
      headerName: fieldToLabelMap[field],
      field,
      cellClass: "v-align",
      sortable: false,
      cellRenderer: field === "spans" ? JSONCellRenderer : undefined,
      cellEditor: field === "spans" ? MultilineJSONCellEditor : undefined,
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
  };

  const getTableRows = useCallback(
    (datasetRecord: DatasetRecord, schema: DatabaseSchema) => {
      let tableRows: Record<string, any> = {};

      if (
        schema === DatabaseSchema.STRING_I_O ||
        schema === DatabaseSchema.LLM_CHAT_CALL
      ) {
        tableRows = {
          id: datasetRecord.id,
          input: getInput(datasetRecord, schema),
          expected_output: getOutput(datasetRecord, schema),
        };
      }
      if (schema === DatabaseSchema.FULL_TRACE) {
        tableRows = {
          id: datasetRecord.id,
          input: getInput(datasetRecord, schema),
          expected_output: getOutput(datasetRecord, schema),
          spans: getTrace(datasetRecord, schema),
        };
      }

      return tableRows;
    },
    []
  );

  const getInput = (
    datasetRecord: DatasetRecord,
    schema: DatabaseSchema
  ): string => {
    if (schema === DatabaseSchema.LLM_CHAT_CALL) {
      return JSON.stringify((datasetRecord.entry as any).input[0]) ?? "";
    }
    if (
      schema === DatabaseSchema.STRING_I_O ||
      schema === DatabaseSchema.FULL_TRACE
    ) {
      return (datasetRecord.entry as any).input;
    }
    return "";
  };

  const getOutput = (
    datasetRecord: DatasetRecord,
    schema: DatabaseSchema
  ): string => {
    if (schema === DatabaseSchema.LLM_CHAT_CALL) {
      return JSON.stringify(datasetRecord.entry.expected_output[0]) ?? "";
    }
    if (
      schema === DatabaseSchema.STRING_I_O ||
      schema === DatabaseSchema.FULL_TRACE
    ) {
      return datasetRecord.entry.expected_output;
    }
    return "";
  };

  const getTrace = (
    datasetRecord: DatasetRecord,
    schema: DatabaseSchema
  ): string => {
    if (schema === DatabaseSchema.FULL_TRACE) {
      return JSON.stringify(datasetRecord.entry.spans) ?? "";
    }
    return "";
  };

  const downloadCSV = (schema: DatabaseSchema) => {
    let fields: string[] = [];

    if (
      schema === DatabaseSchema.STRING_I_O ||
      schema === DatabaseSchema.LLM_CHAT_CALL
    ) {
      fields = ["Input", "Expected Output"];
    } else if (schema === DatabaseSchema.FULL_TRACE) {
      fields = ["Input", "Expected Output", "Spans"];
    }

    type CsvDataRow = [string, string] | [string, string, string];

    const csvData: CsvDataRow[] = [];

    dataset.data?.datasetRecords.forEach((record) => {
      if (
        schema === DatabaseSchema.STRING_I_O ||
        schema === DatabaseSchema.LLM_CHAT_CALL
      ) {
        csvData.push([
          getInput(record, dataset.data!.schema),
          getOutput(record, dataset.data!.schema),
        ]);
      } else {
        csvData.push([
          getInput(record, dataset.data!.schema),
          getOutput(record, dataset.data!.schema),
          getTrace(record, dataset.data!.schema),
        ]);
      }
    });

    const csv = Parse.unparse({
      fields: fields,
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

  const columnDefs = useMemo(() => {
    return dataset.data?.schema ? getHeaders(dataset.data.schema) : [];
  }, [dataset.data?.schema]);

  const rowData = useMemo(() => {
    return dataset.data?.datasetRecords?.map((record) =>
      getTableRows(record, dataset.data!.schema)
    );
  }, [dataset.data, getTableRows]);

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
          onError: (error: any) => {
            toast({
              title: "Error updating record.",
              description: error.message,
              status: "error",
              duration: 5000,
              isClosable: true,
            });
          },
        }
      );
    },
    [updateDatasetRecord, project?.id, dataSetId, toast]
  );

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
              autoGroupColumnDef={{
                headerName: "Group",
                width: 250,
                field: "name",
              }}
              rowData={rowData}
              onCellValueChanged={onCellValueChanged}
            />
          </CardBody>
        </Card>
      </Container>
    </>
  );
}
