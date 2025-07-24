import { Box, Button, HStack, Table, Text, VStack } from "@chakra-ui/react";
import { UnplugIcon } from "lucide-react";
import { type ReactNode } from "react";
import { Edit, MoreVertical, Trash2 } from "react-feather";

import type { LlmConfigWithLatestVersion } from "~/server/prompt-config/repositories/llm-config.repository";

import { GeneratePromptApiSnippetDialog } from "./components/GeneratePromptApiSnippetDialog";

import { MetadataTag } from "~/components/MetadataTag";
import { Menu } from "~/components/ui/menu";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";

export type PromptConfigColumn = {
  key: string;
  header: string;
  width?: string;
  textAlign?: "left" | "center" | "right";
  render: (config: LlmConfigWithLatestVersion) => ReactNode;
};

export const createDefaultColumns = ({
  onDelete,
  onEdit,
}: {
  onDelete: (config: LlmConfigWithLatestVersion) => Promise<void>;
  onEdit: (config: LlmConfigWithLatestVersion) => Promise<void>;
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
    key: "metadata",
    header: "Metadata",
    render: (config) => (
      <VStack alignItems="flex-start">
        <MetadataTag label="prompt_id" value={config.id} copyable />
        {config.latestVersion.id && (
          <MetadataTag
            label="version_id"
            value={config.latestVersion.id}
            copyable
          />
        )}
        <MetadataTag
          label="version"
          value={`v${config.latestVersion.version}`}
          copyable
        />
      </VStack>
    ),
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
        <Menu.Content
          onClick={(event) => {
            // Prevent clicking from bubbling up to the onRowClick handler
            event.stopPropagation();
          }}
        >
          <Menu.Item
            value="edit"
            onClick={(event) => {
              void onEdit(config);
            }}
          >
            <Edit size={16} /> Edit prompt
          </Menu.Item>
          <Menu.Item value="generate-api-snippet">
            <GeneratePromptApiSnippetDialog.Trigger>
              <HStack>
                <UnplugIcon />
                <Text>Show API code snippet</Text>
              </HStack>
            </GeneratePromptApiSnippetDialog.Trigger>
          </Menu.Item>
          <Menu.Item
            value="delete"
            color="red.600"
            onClick={(event) => {
              void onDelete(config);
            }}
          >
            <Trash2 size={16} /> Delete prompt
          </Menu.Item>
        </Menu.Content>
      </Menu.Root>
    ),
  },
];

export interface PromptConfigTableProps {
  configs: LlmConfigWithLatestVersion[];
  isLoading?: boolean;
  columns: PromptConfigColumn[];
  onRowClick?: (config: LlmConfigWithLatestVersion) => void;
}

export function PromptConfigTable({
  configs,
  isLoading,
  columns,
  onRowClick,
}: PromptConfigTableProps) {
  const { project } = useOrganizationTeamProject();

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
