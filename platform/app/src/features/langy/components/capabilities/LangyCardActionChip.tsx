import { Button } from "@chakra-ui/react";
import type { ReactNode } from "react";

/**
 * A quiet action a card offers on its result: an outline chip with an icon
 * and a verb. It reads as an offer, not as something already done, and it
 * never navigates; the card decides what choosing it means.
 */
export function LangyCardActionChip({
  label,
  icon,
  onClick,
  disabled = false,
  testId,
}: {
  label: string;
  icon?: ReactNode;
  onClick: () => void;
  disabled?: boolean;
  testId?: string;
}) {
  return (
    <Button
      size="xs"
      variant="outline"
      onClick={onClick}
      disabled={disabled}
      data-testid={testId}
    >
      {icon} {label}
    </Button>
  );
}
