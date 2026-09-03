import { Button } from "@chakra-ui/react";
import { LuPlus } from "react-icons/lu";
import { Menu } from "../menu";

export type AddMessageButtonProps = {
  onAdd: (role: "user" | "assistant") => void;
  disabled?: boolean;
};

/**
 * Button with dropdown to add a new message with chosen role.
 * Used in prompt playground and HTTP agent test panel.
 */
export function AddMessageButton({ onAdd, disabled }: AddMessageButtonProps) {
  return (
    <Menu.Root>
      <Menu.Trigger asChild>
        <Button size="xs" variant="outline" type="button" disabled={disabled}>
          <LuPlus />
          Add
        </Button>
      </Menu.Trigger>
      {/* portalled={false} to avoid z-index issues when inside drawers */}
      <Menu.Content portalled={false}>
        <Menu.Item value="add-user" onClick={() => onAdd("user")}>
          User
        </Menu.Item>
        <Menu.Item value="add-assistant" onClick={() => onAdd("assistant")}>
          Assistant
        </Menu.Item>
      </Menu.Content>
    </Menu.Root>
  );
}
