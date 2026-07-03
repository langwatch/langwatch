import { Box, Button } from "@chakra-ui/react";
import { ChevronDown, Columns3 } from "lucide-react";
import type React from "react";
import { Tooltip } from "~/components/ui/tooltip";
import { Popover } from "../../../../components/ui/popover";
import { ColumnPickerContent } from "./ColumnPickerContent";

/**
 * Toolbar entry point to the column picker. The picker body
 * (`ColumnPickerContent`) is shared with the trailing "+" column header in
 * the table, so both surfaces stay in lockstep.
 *
 * `compact` drops the dropdown chevron when the toolbar is squeezed, leaving
 * just the columns glyph (the tooltip + click behaviour are unchanged).
 */
export const ColumnsDropdown: React.FC<{ compact?: boolean }> = ({
  compact = false,
}) => {
  return (
    <Popover.Root positioning={{ placement: "bottom-end" }}>
      <Tooltip
        content="Show or hide columns"
        positioning={{ placement: "bottom" }}
      >
        {/* Intermediate span keeps Tooltip's asChild clone off the
            Popover.Trigger's DOM node — see GroupingSelector.tsx for why
            nesting two asChild triggers directly breaks anchor positioning. */}
        <Box as="span" display="inline-flex">
          <Popover.Trigger asChild>
            <Button
              size="xs"
              variant="outline"
              aria-label="Show or hide columns in the table"
              gap={1}
              paddingX={2}
            >
              <Columns3 size={14} />
              {!compact && <ChevronDown size={12} />}
            </Button>
          </Popover.Trigger>
        </Box>
      </Tooltip>
      <Popover.Content width="auto" padding={0}>
        <ColumnPickerContent />
      </Popover.Content>
    </Popover.Root>
  );
};
