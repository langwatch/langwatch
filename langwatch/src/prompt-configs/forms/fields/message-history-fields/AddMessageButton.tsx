import { Button } from "@chakra-ui/react";
import { Menu } from "../../../../components/ui/menu";
import { Plus } from "react-feather";

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
      <Menu.Trigger>
        <Button size="xs" variant="ghost" type="button">
          <Plus size={16} />
        </Button>
      </Menu.Trigger>
      <Menu.Content>
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
