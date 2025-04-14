import {
  Box,
  Button,
  HStack,
  Icon,
  Table,
  Text,
  Tooltip,
} from "@chakra-ui/react";
import { formatDistanceToNow } from "date-fns";
import { Edit, Eye, MoreHorizontal, Trash } from "react-feather";
import { Menu } from "../ui/menu";

export type PromptConfigWithVersion = {
  id: string;
  name: string;
  createdAt: Date;
  updatedAt: Date;
  projectId: string;
  latestVersion?: {
    id: string;
    version: string;
    schemaVersion: string;
    createdAt: Date;
    commitMessage?: string | null;
    author?: {
      id: string;
      name?: string | null;
      email?: string | null;
      image?: string | null;
    } | null;
  } | null;
};

export interface PromptConfigTableProps {
  configs: PromptConfigWithVersion[];
  isLoading: boolean;
  onViewVersions: (config: PromptConfigWithVersion) => void;
  onEditName: (config: PromptConfigWithVersion) => void;
  onDelete: (config: PromptConfigWithVersion) => void;
  projectSlug: string;
}

export function PromptConfigTable({
  configs,
  isLoading,
  onViewVersions,
  onEditName,
  onDelete,
  projectSlug,
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
      >
        <Text fontSize="lg" color="gray.600">
          No prompt configurations found. Create your first one!
        </Text>
      </Box>
    );
  }

  return (
    <Table.Root variant="line" fontSize="sm">
      <Table.Header>
        <Table.Row>
          <Table.ColumnHeader>Name</Table.ColumnHeader>
          <Table.ColumnHeader>Latest Version</Table.ColumnHeader>
          <Table.ColumnHeader>Schema Version</Table.ColumnHeader>
          <Table.ColumnHeader>Last Updated</Table.ColumnHeader>
          <Table.ColumnHeader>Created By</Table.ColumnHeader>
          <Table.ColumnHeader width="120px" textAlign="right">
            Actions
          </Table.ColumnHeader>
        </Table.Row>
      </Table.Header>
      <Table.Body>
        {configs.map((config) => (
          <Table.Row key={config.id}>
            <Table.Cell fontWeight="medium">{config.name}</Table.Cell>
            <Table.Cell>
              {config.latestVersion ? (
                <HStack gap={1}>
                  <Text>v{config.latestVersion.version}</Text>
                  {/* {config.latestVersion.commitMessage && (
                    // <Tooltip
                    //   content={config.latestVersion.commitMessage}
                    //   placement="top"
                    // >
                    //   <Box>
                    //     <Icon>
                    //       <Eye size={14} />
                    //     </Icon>
                    //   </Box>
                    // </Tooltip>
                  )} */}
                </HStack>
              ) : (
                <Text color="gray.500" fontStyle="italic">
                  No versions
                </Text>
              )}
            </Table.Cell>
            <Table.Cell>
              {config.latestVersion?.schemaVersion || "-"}
            </Table.Cell>
            <Table.Cell>
              {formatDistanceToNow(new Date(config.updatedAt), {
                addSuffix: true,
              })}
            </Table.Cell>
            <Table.Cell>
              {config.latestVersion?.author?.name ||
                config.latestVersion?.author?.email ||
                "-"}
            </Table.Cell>
            <Table.Cell textAlign="right">
              <Menu.Root positioning={{ placement: "bottom-end" }}>
                <Menu.Trigger asChild>
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-label="More options"
                    padding={1}
                  >
                    <MoreHorizontal size={16} />
                  </Button>
                </Menu.Trigger>
                <Menu.Content minWidth="150px">
                  <Menu.Item
                    value="view-versions"
                    onClick={() => onViewVersions(config)}
                  >
                    <Eye size={14} style={{ marginRight: "8px" }} />
                    View Versions
                  </Menu.Item>
                  <Menu.Item
                    value="edit-name"
                    onClick={() => onEditName(config)}
                  >
                    <Edit size={14} style={{ marginRight: "8px" }} />
                    Edit Name
                  </Menu.Item>
                  <Menu.Item
                    value="delete"
                    color="red.600"
                    onClick={() => onDelete(config)}
                  >
                    <Trash size={14} style={{ marginRight: "8px" }} />
                    Delete
                  </Menu.Item>
                </Menu.Content>
              </Menu.Root>
            </Table.Cell>
          </Table.Row>
        ))}
      </Table.Body>
    </Table.Root>
  );
}
