import { Box, Button } from "@chakra-ui/react";
import { Tooltip } from "@langwatch/design-system/tooltip";

import { refusalCopy } from "../../model/refusal-copy.ts";

/**
 * Remove, stood down before the click where the detach guard would refuse, with
 * the registry's words for that code. The wrapper is the tooltip trigger because a
 * disabled button receives no pointer events.
 */
export function RemoveAddressButton({
  refusalCode,
  removable,
  isPending,
  onRemove,
}: {
  refusalCode: string | null;
  removable: boolean;
  isPending: boolean;
  onRemove: () => void;
}) {
  const button = (
    <Button
      size="xs"
      variant="ghost"
      colorPalette="red"
      disabled={!removable || isPending}
      onClick={onRemove}
      data-testid="remove-address"
    >
      Remove
    </Button>
  );

  if (removable || !refusalCode) return button;

  return (
    <Tooltip content={refusalCopy(refusalCode)} showArrow>
      <Box data-testid="remove-address-blocked">{button}</Box>
    </Tooltip>
  );
}
