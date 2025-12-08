import { Button } from "@chakra-ui/react";
import { Minus } from "lucide-react";

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
      <Minus size={16} />
    </Button>
  );
}
