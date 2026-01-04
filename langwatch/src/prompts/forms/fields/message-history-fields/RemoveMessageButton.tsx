import { Button } from "@chakra-ui/react";
import { LuMinus } from "react-icons/lu";

/**
 * RemoveMessageButton
 * Single Responsibility: Remove the current message row.
 */
export function RemoveMessageButton(props: {
  onRemove: () => void;
  disabled?: boolean;
}) {
  const { onRemove, disabled } = props;
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
