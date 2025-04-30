import { Box, Button, Card, Table, Text } from "@chakra-ui/react";
import { Trash } from "react-feather";
import type { LlmPromptConfig } from "@prisma/client";
import { type ReactNode } from "react";

export type PromptConfigColumn = {
  key: string;
  header: string;
  width?: string;
  textAlign?: "left" | "center" | "right";
  render: (config: LlmPromptConfig) => ReactNode;
};

export const createDefaultColumns = ({
  onDelete,
}: {
  onDelete: (config: LlmPromptConfig) => Promise<void>;
}): PromptConfigColumn[] => [
  {
    key: "name",
    header: "Name",
    width: "100%",
    render: (config) => <Text>{config.name}</Text>,
  },
  {
    key: "actions",
    header: "Actions",
    textAlign: "center",
    render: (config) => (
      <Button
        size="sm"
        variant="ghost"
        colorScheme="red"
        onClick={(e) => {
          e.stopPropagation();
          void onDelete(config);
        }}
      >
        <Trash size={16} />
      </Button>
    ),
  },
];

export interface PromptConfigTableProps {
  configs: LlmPromptConfig[];
  isLoading?: boolean;
  columns: PromptConfigColumn[];
  onRowClick?: (config: LlmPromptConfig) => void;
}

export function PromptConfigTable({
  configs,
  isLoading,
  columns,
  onRowClick,
}: PromptConfigTableProps) {
  if (isLoading) {
    return <Text>Loading prompt configurations...</Text>;
  }

  if (configs.length === 0) {
    return (
      <Box
        textAlign="center"
        py={10}
        px={6}
        borderWidth="1px"
        borderRadius="md"
        borderStyle="dashed"
        width="full"
      >
        <Text fontSize="lg" color="gray.600" textAlign="center">
          No prompt configurations found. Create your first one!
        </Text>
      </Box>
    );
  }

  return (
    <Table.Root variant="line" fontSize="sm">
      <Table.Header>
        <Table.Row>
          {columns.map((column) => (
            <Table.ColumnHeader
              key={column.key}
              width={column.width}
              textAlign={column.textAlign}
            >
              {column.header}
            </Table.ColumnHeader>
          ))}
        </Table.Row>
      </Table.Header>
      <Table.Body>
        {configs.map((config) => (
          <Table.Row
            key={config.id}
            onClick={() => onRowClick?.(config)}
            cursor={onRowClick ? "pointer" : "default"}
          >
            {columns.map((column) => (
              <Table.Cell
                key={`${config.id}-${column.key}`}
                textAlign={column.textAlign}
              >
                {column.render(config)}
              </Table.Cell>
            ))}
          </Table.Row>
        ))}
      </Table.Body>
    </Table.Root>
  );
}
