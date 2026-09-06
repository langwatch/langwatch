import { Button } from "@chakra-ui/react";
import { LuMinus } from "react-icons/lu";

export type RemoveMessageButtonProps = {
  onRemove: () => void;
  disabled?: boolean;
};

/**
 * Button to remove a message row.
 * Used in prompt playground and HTTP agent test panel.
 */
export function RemoveMessageButton({
  onRemove,
  disabled,
}: RemoveMessageButtonProps) {
  return (
    <Button
      size="xs"
      variant="ghost"
      onClick={onRemove}
      type="button"
      disabled={disabled}
    >
      <LuMinus />
    </Button>
  );
}
