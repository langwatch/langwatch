import { Chip } from "@langwatch/design-system/chip";
import { Box, HStack, Wrap } from "@langwatch/design-system/primitives";
import { type ReactNode, useMemo, useRef } from "react";

import { useOverflowVisibility } from "../../../../behavior/explorer/use-overflow-visibility.ts";

export interface FittedChip {
  /** Stable id; also the measurement key. */
  id: string;
  node: ReactNode;
}

// Room for the "+N" chip (about 40px) and the gap before it, which sits beside the row.
const OVERFLOW_CHIP_RESERVE_PX = 52;
const ID_SEPARATOR = "\u0000";

/**
 * One line of chips: as many as fit, in order, and the rest behind a "+N" chip whose
 * popover lists them. Chips are moved whole, never clipped.
 */
export function FittedChipRow({
  chips,
  trailing,
  ariaLabel,
}: {
  chips: FittedChip[];
  /** Rendered after the row, e.g. a loading skeleton. */
  trailing?: ReactNode;
  ariaLabel?: string;
}) {
  const rowRef = useRef<HTMLDivElement>(null);
  // The overflow hook re-measures on every new `items` array, so it is keyed on the ids.
  const idKey = chips.map((c) => c.id).join(ID_SEPARATOR);
  const ids = useMemo(() => (idKey ? idKey.split(ID_SEPARATOR) : []), [idKey]);
  const hiddenIds = useOverflowVisibility({
    scrollerRef: rowRef,
    items: ids,
    reservePx: OVERFLOW_CHIP_RESERVE_PX,
  });
  const overflow = chips.filter((c) => hiddenIds.has(c.id));

  if (chips.length === 0 && !trailing) return null;

  return (
    <HStack gap={1.5} align="center" minWidth={0} aria-label={ariaLabel}>
      <HStack
        ref={rowRef}
        gap={1.5}
        align="center"
        flexWrap="nowrap"
        overflow="hidden"
        flex="1"
        minWidth={0}
      >
        {chips.map((c) => (
          <Box
            key={c.id}
            data-overflow-id={c.id}
            display={hiddenIds.has(c.id) ? "none" : "inline-flex"}
            flexShrink={0}
          >
            {c.node}
          </Box>
        ))}
        {trailing}
      </HStack>
      {overflow.length > 0 && (
        <Box flexShrink={0}>
          <Chip
            value={`+${overflow.length}`}
            tone="neutral"
            ariaLabel={`Show ${overflow.length} more`}
            popover={
              <Wrap gap={1.5} padding={3}>
                {overflow.map((c) => (
                  <Box key={c.id} display="inline-flex">
                    {c.node}
                  </Box>
                ))}
              </Wrap>
            }
          />
        </Box>
      )}
    </HStack>
  );
}
