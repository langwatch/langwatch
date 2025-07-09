import { Button, HStack, Text } from "@chakra-ui/react";
import type { LlmPromptConfig } from "@prisma/client";
import { UnplugIcon } from "lucide-react";
import { Edit, MoreVertical, Trash2, BarChart2 } from "react-feather";

import { GeneratePromptApiSnippetDialog } from "./GeneratePromptApiSnippetDialog";

import { useDrawer } from "~/components/CurrentDrawer";
import { Menu } from "~/components/ui/menu";

interface PromptConfigActionsProps {
  config: LlmPromptConfig;
  onEdit: (config: LlmPromptConfig) => Promise<void>;
  onDelete: (config: LlmPromptConfig) => Promise<void>;
}

export function PromptConfigActions({
  config,
  onEdit,
  onDelete,
}: PromptConfigActionsProps) {
  const { openDrawer } = useDrawer();

  return (
    <Menu.Root>
      <Menu.Trigger asChild>
        <Button
          variant="ghost"
          onClick={(event) => {
            event.stopPropagation();
          }}
        >
          <MoreVertical />
        </Button>
      </Menu.Trigger>
      <Menu.Content
        onClick={(event) => {
          event.stopPropagation();
        }}
      >
        <Menu.Item value="edit" onClick={() => void onEdit(config)}>
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
          value="analytics"
          onClick={() => {
            // openDrawer("promptAnalytics", { promptConfigId: config.id });
            openDrawer("llmModelCost", { id: config.id });
          }}
        >
          <BarChart2 size={16} /> Analytics
        </Menu.Item>

        <Menu.Item
          value="delete"
          color="red.600"
          onClick={() => void onDelete(config)}
        >
          <Trash2 size={16} /> Delete prompt
        </Menu.Item>
      </Menu.Content>
    </Menu.Root>
  );
}
