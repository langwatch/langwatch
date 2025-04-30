import { Box, Button, Table, Text } from "@chakra-ui/react";
import { Edit, MoreVertical, Trash2 } from "react-feather";
import type { LlmPromptConfig } from "@prisma/client";
import { type ReactNode } from "react";
import { Menu } from "~/components/ui/menu";

export type PromptConfigColumn = {
  key: string;
  header: string;
  width?: string;
  textAlign?: "left" | "center" | "right";
  render: (config: LlmPromptConfig) => ReactNode;
};

export const createDefaultColumns = ({
  onDelete,
  onEdit,
}: {
  onDelete: (config: LlmPromptConfig) => Promise<void>;
  onEdit: (config: LlmPromptConfig) => Promise<void>;
}): PromptConfigColumn[] => [
  {
    key: "name",
    header: "Name",
    render: (config) => <Text>{config.name}</Text>,
  },
  // Last Updated
  {
    key: "lastUpdated",
    header: "Last Updated",
    render: (config) => <Text>{config.updatedAt.toLocaleString()}</Text>,
  },
  {
    key: "actions",
    header: "Actions",
    textAlign: "center",
    render: (config) => (
      <Menu.Root>
        <Menu.Trigger asChild>
          <Button
            variant={"ghost"}
            onClick={(event) => {
              event.stopPropagation();
            }}
          >
            <MoreVertical />
          </Button>
        </Menu.Trigger>
        <Menu.Content>
          <Menu.Item
            value="edit"
            onClick={(event) => {
              event.stopPropagation();
              void onEdit(config);
            }}
          >
            <Edit size={16} /> Edit dataset
          </Menu.Item>
          <Menu.Item
            value="delete"
            color="red.600"
            onClick={(event) => {
              event.stopPropagation();
              void onDelete(config);
            }}
          >
            <Trash2 size={16} /> Delete dataset
          </Menu.Item>
        </Menu.Content>
      </Menu.Root>
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
