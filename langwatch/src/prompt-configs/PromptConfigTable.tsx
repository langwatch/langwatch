import { Box, Table, Text } from "@chakra-ui/react";
import type { LlmPromptConfig } from "@prisma/client";
import { type ReactNode } from "react";

import { GeneratePromptApiSnippetDialog } from "./components/GeneratePromptApiSnippetDialog";

import { PromptConfigActions } from "./components/PromptConfigTableActions";
import { useDrawer } from "~/components/CurrentDrawer";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";

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
      <PromptConfigActions
        config={config}
        onEdit={onEdit}
        onDelete={onDelete}
      />
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
  const { project } = useOrganizationTeamProject();
  const { openDrawer } = useDrawer();

  if (isLoading || !project) {
    return <Text>Loading prompts...</Text>;
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
    <>
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
            <GeneratePromptApiSnippetDialog
              key={config.id}
              configId={config.id}
              apiKey={project?.apiKey}
            >
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
            </GeneratePromptApiSnippetDialog>
          ))}
        </Table.Body>
      </Table.Root>
    </>
  );
}
