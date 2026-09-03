/**
 * The small x that takes a block the chips added back out of a dialog.
 *
 * @see specs/features/agent-testing/run-dialog.feature
 * @see specs/features/agent-testing/cases-table.feature
 */

import { chakra } from "@chakra-ui/react";
import { X } from "lucide-react";
import { FG_MUTED, QUIET_BUTTON_SHADOW } from "../../../../model/agent-testing/shared/design";

export function RemoveBlockButton({
  label,
  onClick,
}: {
  /** What the control removes, for people who cannot see the x. */
  label: string;
  onClick: () => void;
}) {
  return (
    <chakra.button
      type="button"
      marginLeft="auto"
      display="flex"
      alignItems="center"
      cursor="pointer"
      color={FG_MUTED}
      boxShadow={QUIET_BUTTON_SHADOW}
      _hover={{ color: "red.fg" }}
      title="Remove"
      aria-label={label}
      onClick={onClick}
    >
      <X size={13} />
    </chakra.button>
  );
}
