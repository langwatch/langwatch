/**
 * The name of the open test suite, and the control that renames it.
 *
 * A test suite carries only a name, so renaming is the whole of editing one.
 * The control stays out of the way until the pointer is over the name, and it
 * is an ordinary button, so it takes keyboard focus and a person who uses no
 * pointer reaches it the same way.
 *
 * @see specs/features/agent-testing/cases-table.feature
 */

import { HStack, IconButton, Text } from "@chakra-ui/react";
import { Pencil } from "lucide-react";
import { FG_MUTED } from "../shared/design";

/** What the rename control is called, for the pointer and for a screen reader. */
export const RENAME_SUITE_LABEL = "Rename test suite";

export type SuiteNameHeadingProps = {
  name: string;
  /** Nothing when the reader cannot rename the suite, or it is read-only. */
  onRename?: () => void;
};

export function SuiteNameHeading({ name, onRename }: SuiteNameHeadingProps) {
  return (
    <HStack className="group" gap={1} minWidth={0}>
      <Text fontSize="14px" fontWeight="semibold" color="fg" truncate>
        {name}
      </Text>
      {onRename && (
        <IconButton
          aria-label={RENAME_SUITE_LABEL}
          title={RENAME_SUITE_LABEL}
          size="2xs"
          variant="ghost"
          height="20px"
          minWidth="20px"
          color={FG_MUTED}
          opacity={0}
          _groupHover={{ opacity: 1 }}
          _focusVisible={{ opacity: 1 }}
          onClick={onRename}
          data-testid="suite-rename-control"
        >
          <Pencil size={12} />
        </IconButton>
      )}
    </HStack>
  );
}
