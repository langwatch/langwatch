import {
  Box,
  Button,
  Checkbox,
  FormControl,
  FormHelperText,
  FormLabel,
  HStack,
  Spacer,
  VStack,
} from "@chakra-ui/react";
import { Edit2 } from "react-feather";
import type {
  DatasetColumns,
  DatasetRecordEntry,
} from "../../server/datasets/types";
import {
  DatasetGrid,
  HeaderCheckboxComponent,
  type DatasetColumnDef,
} from "./DatasetGrid";

import type { CustomCellRendererProps } from "@ag-grid-community/react";
import type { Dataset } from "@prisma/client";
import { useMemo } from "react";
import { TracesMapping, type MappingState } from "./DatasetMapping";

interface DatasetMappingPreviewProps {
  traces: any[]; // Replace 'any' with your trace type
  columnTypes: DatasetColumns;
  rowData: DatasetRecordEntry[];
  selectedDataset: Dataset;
  onEditColumns: () => void;
  onRowDataChange: (entries: DatasetRecordEntry[]) => void;
  paragraph?: string;
  setDatasetTriggerMapping: (mapping: MappingState) => void;
}

export function DatasetMappingPreview({
  traces,
  columnTypes,
  rowData,
  onEditColumns,
  onRowDataChange,
  paragraph,
  selectedDataset,
  setDatasetTriggerMapping,
}: DatasetMappingPreviewProps) {
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
      minWidth: ["trace_id", "total_cost"].includes(name)
        ? 120
        : ["timestamp"].includes(name)
        ? 160
        : 200,
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
    <FormControl width="full" paddingY={4}>
      <HStack width="full" spacing="64px" align="start">
        <VStack align="start" maxWidth="50%">
          <FormLabel margin={0}>Mapping</FormLabel>
          <FormHelperText margin={0} fontSize={13} marginBottom={2}>
            Map the trace data to the dataset columns
          </FormHelperText>

          <TracesMapping
            dataset={selectedDataset}
            traces={traces}
            columnTypes={columnTypes}
            setDatasetEntries={onRowDataChange}
            setDatasetTriggerMapping={setDatasetTriggerMapping}
          />
        </VStack>
        <VStack align="start" width="full" height="full">
          <HStack width="full" align="end">
            <VStack align="start">
              <FormLabel margin={0}>Preview</FormLabel>
              <FormHelperText margin={0} fontSize={13}>
                {paragraph
                  ? paragraph
                  : "Those are the rows that are going to be added, double click on the cell to edit them"}
              </FormHelperText>
            </VStack>
            <Spacer />
            <Button
              size="sm"
              colorScheme="blue"
              variant="outline"
              leftIcon={<Edit2 height={16} />}
              onClick={onEditColumns}
            >
              Edit Columns
            </Button>
          </HStack>
          <Box width="full" display="block" paddingTop={2}>
            <DatasetGrid
              columnDefs={columnDefs}
              rowData={rowData}
              onCellValueChanged={({ data }: { data: DatasetRecordEntry }) => {
                onRowDataChange(
                  rowData.map((row) => (row.id === data.id ? data : row))
                );
              }}
            />
          </Box>
        </VStack>
      </HStack>
    </FormControl>
  );
}
