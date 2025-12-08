import { Button, HStack } from "@chakra-ui/react";
import type { UseFieldArrayReturn } from "react-hook-form";
import type { PromptConfigFormValues } from "~/prompts/types";
import { Menu } from "../../../../components/ui/menu";
import { Minus, Plus } from "lucide-react";

/**
 * AddRemoveMessageFieldButton
 * Single Responsibility: Provide controls to remove the last message
 * and add a new message of a specific role (user/assistant).
 */
export function AddRemoveMessageFieldButton({
  messageFields,
}: {
  messageFields: UseFieldArrayReturn<
    PromptConfigFormValues,
    "version.configData.messages",
    "id"
  >;
}) {
  const { append, remove } = messageFields;

  function handleAdd(role: "user" | "assistant") {
    append({ role, content: "" });
  }

  function handleRemove() {
    if (messageFields.fields.length > 0) {
      remove(messageFields.fields.length - 1);
    }
  }

  return (
    <HStack gap={2}>
      <Button
        size="xs"
        variant="ghost"
        onClick={handleRemove}
        type="button"
        disabled={messageFields.fields.length === 0}
      >
        <Minus size={16} />
      </Button>

      <Menu.Root>
        <Menu.Trigger>
          <Button size="xs" variant="ghost" type="button">
            <Plus size={16} />
          </Button>
        </Menu.Trigger>
        <Menu.Content>
          <Menu.Item value="add-user" onClick={() => handleAdd("user")}>
            Add user message
          </Menu.Item>
          <Menu.Item
            value="add-assistant"
            onClick={() => handleAdd("assistant")}
          >
            Add assistant message
          </Menu.Item>
        </Menu.Content>
      </Menu.Root>
    </HStack>
  );
}
