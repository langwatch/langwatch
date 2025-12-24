import {
  Button,
  Flex,
  Spinner,
  Text,
  HStack,
  Input,
  type CheckboxCheckedChangeDetails,
  type FlexProps,
} from "@chakra-ui/react";
import { useMemo } from "react";
import { Columns, Download, RotateCcw, Search } from "lucide-react";
import {
  PopoverRoot,
  PopoverTrigger,
  PopoverContent,
  PopoverBody,
} from "../popover";
import { Checkbox } from "../checkbox";
import type { ReactNode } from "react";
import type { Column } from "@tanstack/react-table";

interface DataGridToolbarProps extends FlexProps {
  children: ReactNode;
}

/**
 * Toolbar with filter bar, column visibility, and export controls
 */
function DataGridToolbarRoot({ children, ...props }: DataGridToolbarProps) {
  return (
    <Flex
      direction="row"
      align="center"
      justify="space-between"
      gap={4}
      px={3}
      paddingInline={0}
      {...props}
    >
      {children}
    </Flex>
  );
}

function DataGridToolbarLoadingIndicator({
  isLoading,
}: {
  isLoading: boolean;
}) {
  if (!isLoading) return null;
  return <Spinner size="sm" color="gray.500" />;
}

function DataGridToolbarResetFiltersAndSorting({
  onResetFiltersAndSorting,
}: {
  onResetFiltersAndSorting: () => void;
}) {
  return (
    <Button size="sm" onClick={onResetFiltersAndSorting}>
      <RotateCcw size={14} />
      <Text ml={1}>Reset</Text>
    </Button>
  );
}

function DataGridToolbarColumnVisibility<TData>({
  columns,
}: {
  columns: Column<TData>[];
}) {
  const displayColumns = useMemo(
    () => columns.filter((column) => column.getCanHide()),
    [columns]
  );
  return (
    <PopoverRoot>
      <PopoverTrigger asChild>
        <Button size="sm" variant="outline">
          <Columns size={14} />
          <Text ml={1}>Columns</Text>
        </Button>
      </PopoverTrigger>
      <PopoverContent width="250px">
        <PopoverBody>
          <Flex direction="column" gap={2}>
            <Text fontWeight="medium" fontSize="sm" mb={1}>
              Visible Columns
            </Text>
            {displayColumns.map((column) => (
              <Checkbox
                key={column.id}
                checked={column.getIsVisible()}
                onChange={(e) => column.toggleVisibility(e.target.checked)}
              >
                {typeof column.columnDef.header === "string"
                  ? column.columnDef.header
                  : ""}
              </Checkbox>
            ))}
          </Flex>
        </PopoverBody>
      </PopoverContent>
    </PopoverRoot>
  );
}

function DataGridToolbarExport({ onExport }: { onExport: () => void }) {
  return (
    <Button size="sm" variant="outline" onClick={onExport}>
      <Download size={14} />
      <Text ml={1}>Export CSV</Text>
    </Button>
  );
}

function DataGridToolbarSearch({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <HStack
      flex="0 0 auto"
      minW="200px"
      bg="white"
      borderRadius="lg"
      shadow="xs"
      overflow="hidden"
      px={2}
      border="1px solid"
      borderColor="gray.200"
    >
      <Search size={16} color="gray" />
      <Input
        border="none"
        outline="none"
        size="sm"
        placeholder="Search..."
        value={value}
        onChange={(e) => onChange(e.target.value)}
        bg="white"
        maxW="200px"
      />
    </HStack>
  );
}

export const DataGridToolbar = {
  Root: DataGridToolbarRoot,
  LoadingIndicator: DataGridToolbarLoadingIndicator,
  ResetFiltersAndSorting: DataGridToolbarResetFiltersAndSorting,
  ColumnVisibility: DataGridToolbarColumnVisibility,
  Export: DataGridToolbarExport,
  Search: DataGridToolbarSearch,
};
