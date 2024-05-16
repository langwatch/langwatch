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
import { displayName } from "~/utils/datasets";

import "ag-grid-community/styles/ag-grid.css";
import "ag-grid-community/styles/ag-theme-quartz.css";
import { AgGridReact } from "ag-grid-react";
import { useCallback, useMemo } from "react";
import { MultilineCellEditor } from "../../../components/datasets/MultilineCellEditor";

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
    }
  );

  const getHeaders = (schema: DatabaseSchema) => {
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

    return fields.map((field) => ({
      headerName: fieldToLabelMap[field],
      field,
      editable: true,
    }));
  };

  const getTableRows = useCallback(
    (datasetRecord: DatasetRecord, schema: DatabaseSchema) => {
      let tableRows: any = {};

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

  const getInput = (datasetRecord: DatasetRecord, schema: DatabaseSchema) => {
    if (schema === DatabaseSchema.LLM_CHAT_CALL) {
      return JSON.stringify((datasetRecord.entry as any).input[0]) ?? "";
    }
    if (
      schema === DatabaseSchema.STRING_I_O ||
      schema === DatabaseSchema.FULL_TRACE
    ) {
      return (datasetRecord.entry as any).input;
    }
  };

  const getOutput = (datasetRecord: any, schema: DatabaseSchema) => {
    if (schema === DatabaseSchema.LLM_CHAT_CALL) {
      return JSON.stringify(datasetRecord.entry.expected_output[0]) ?? "";
    }
    if (
      schema === DatabaseSchema.STRING_I_O ||
      schema === DatabaseSchema.FULL_TRACE
    ) {
      return datasetRecord.entry.expected_output;
    }
  };

  const getTrace = (datasetRecord: any, schema: DatabaseSchema) => {
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
      <style>{`
        .ag-theme-quartz .ag-cell {
          white-space: pre-wrap; /* Enable word wrapping */
          overflow: visible; /* Ensure the cell expands to fit content */
          line-height: 1.6em;
          padding: 0;
        }
        .ag-theme-quartz .ag-cell .ag-cell-value {
          padding: 8px 16px;
        }
        .ag-theme-quartz .ag-cell .chakra-textarea {
          height: 100%!important;
        }
        .ag-large-text, .ag-large-text-input, .ag-large-text-input > .ag-input-wrapper, .ag-input-wrapper > textarea {
          width: 100%;
          height: 100%!important;
          padding: 0;
        }
        .ag-input-wrapper > textarea {
          padding: 8px 16px;
        }
      `}</style>
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
            {dataset.data ? displayName(dataset.data?.schema) : ""}
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
          <CardBody className="ag-theme-quartz">
            {dataset.data && dataset.data.datasetRecords.length == 0 ? (
              <Text>No data found</Text>
            ) : (
              <AgGridReact
                columnDefs={columnDefs}
                rowData={rowData}
                onCellValueChanged={onCellValueChanged}
                loadingOverlayComponent={() => <Skeleton height="20px" />}
                reactiveCustomComponents={true}
                enableCellEditingOnBackspace={false}
                domLayout="autoHeight"
                defaultColDef={{
                  flex: 1,
                  minWidth: 100,
                  resizable: true,
                  sortable: true,
                  filter: true,
                  editable: true,
                  autoHeight: true,
                  cellEditor: MultilineCellEditor,
                  suppressKeyboardEvent: (props) => {
                    if (props.event.key == "Enter" && props.event.shiftKey) {
                      props.event.stopPropagation();
                      return true;
                    }
                    return false;
                  },
                }}
              />
            )}
          </CardBody>
        </Card>
      </Container>
    </>
  );
}
