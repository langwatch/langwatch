import {
  Box,
  Button,
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
import { TracesMapping } from "./DatasetMapping";
import { DatasetGrid } from "./DatasetGrid";
import type { DatasetColumnDef } from "./DatasetGrid";

interface DatasetMappingPreviewProps {
  traces: any[]; // Replace 'any' with your trace type
  columnTypes: DatasetColumns;
  columnDefs: DatasetColumnDef[];
  rowData: DatasetRecordEntry[];
  onEditColumns: () => void;
  onRowDataChange: (entries: DatasetRecordEntry[]) => void;
  paragraph?: string;
}

export function DatasetMappingPreview({
  traces,
  columnTypes,
  columnDefs,
  rowData,
  onEditColumns,
  onRowDataChange,
  paragraph,
}: DatasetMappingPreviewProps) {
  console.log("rowData", rowData);
  return (
    <FormControl width="full" paddingY={4}>
      <HStack width="full" spacing="64px" align="start">
        <VStack align="start" maxWidth="50%">
          <FormLabel margin={0}>Mapping</FormLabel>
          <FormHelperText margin={0} fontSize={13} marginBottom={2}>
            Map the trace data to the dataset columns
          </FormHelperText>

          <TracesMapping
            traces={traces}
            columnTypes={columnTypes}
            setDatasetEntries={onRowDataChange}
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
