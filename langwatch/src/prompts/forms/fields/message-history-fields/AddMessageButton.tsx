import { Button } from "@chakra-ui/react";
import { Plus } from "react-feather";
import { Menu } from "../../../../components/ui/menu";
import { LuPlus } from "react-icons/lu";

/**
 * AddMessageButton
 * Single Responsibility: Add a new message of a chosen role (user/assistant).
 */
export function AddMessageButton(props: {
  onAdd: (role: "user" | "assistant") => void;
}) {
  const { onAdd } = props;

  return (
    <Menu.Root>
      <Menu.Trigger asChild>
        <Button size="xs" variant="outline" type="button">
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
