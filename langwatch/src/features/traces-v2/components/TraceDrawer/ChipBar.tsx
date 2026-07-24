import { HStack, VStack } from "@chakra-ui/react";
import type { ReactElement, ReactNode } from "react";
import type { ChipProps } from "./Chip";
import { Chip } from "./Chip";

export interface ChipDef extends ChipProps {
  /** Stable key for React reconciliation. */
  id: string;
  /**
   * Lower numbers = higher priority (kept visible when collapsing).
   * Defaults to insertion order.
   */
  priority?: number;
  /**
   * Skip the chip without callers needing to filter the array. Useful for
   * conditional chips driven by trace-level data.
   */
  hidden?: boolean;
}

interface ChipBarProps {
  chips: ChipDef[];
  /** Beyond this count, low-priority chips collapse into a "+N" pill. */
  maxVisible?: number;
  /** Optional trailing slot — e.g. relative timestamp on the far right. */
  endSlot?: ReactNode;
}

const DEFAULT_MAX_VISIBLE = 6;

/**
 * Horizontal strip of Chip pills with consistent spacing and a graceful
 * overflow affordance. Drives the metadata strip above the drawer mode
 * switch — service, origin, scenario link, prompts, sdk, etc. all flow
 * through here.
 */
export function ChipBar({
  chips,
  maxVisible = DEFAULT_MAX_VISIBLE,
  endSlot,
}: ChipBarProps) {
  const { primary, overflowChip } = splitChipsForOverflow(chips, maxVisible);

  return (
    <HStack gap={1.5} flexWrap="wrap" align="center" width="full">
      {primary.map((c) => (
        <Chip key={c.id} {...c} />
      ))}
      {overflowChip}
      {endSlot && (
        <HStack marginLeft="auto" flexShrink={0}>
          {endSlot}
        </HStack>
      )}
    </HStack>
  );
}

/**
 * Lower-level helper exposing ChipBar's overflow logic so callers can
 * compose the primary chips inline with other content (e.g. metrics + pins
 * + chips in one wrapped strip) and still get the "+N more" affordance.
 *
 * Returns `primary` (chips to render in document order) and `overflowChip`
 * (a single ready-to-render `<Chip>` whose popover lists the dropped chips,
 * or `null` when nothing overflows).
 */
export function splitChipsForOverflow(
  chips: ChipDef[],
  maxVisible: number = DEFAULT_MAX_VISIBLE,
): { primary: ChipDef[]; overflowChip: ReactElement | null } {
  const visibleChips = chips
    .filter((c) => !c.hidden)
    .map((c, i) => ({ ...c, priority: c.priority ?? i }));

  const overflowing = visibleChips.length > maxVisible;
  const primaryPicks = overflowing
    ? [...visibleChips]
        .sort((a, b) => a.priority - b.priority)
        .slice(0, maxVisible - 1)
    : visibleChips;
  const overflow = overflowing
    ? visibleChips.filter((c) => !primaryPicks.some((p) => p.id === c.id))
    : [];

  // Preserve original insertion order for the visible row so the eye sees
  // a stable layout — only the dropped-out ones move into "+N".
  const primaryById = new Set(primaryPicks.map((c) => c.id));
  const primary = visibleChips.filter((c) => primaryById.has(c.id));

  const overflowChip: ReactElement | null =
    overflow.length > 0 ? (
      <Chip
        key="__overflow"
        label={`+${overflow.length}`}
        value="more"
        tone="neutral"
        popover={
          <VStack align="stretch" gap={1.5} padding={3}>
            {overflow.map((c) => (
              <HStack key={c.id} gap={2}>
                <Chip {...c} />
              </HStack>
            ))}
          </VStack>
        }
        ariaLabel={`Show ${overflow.length} more`}
      />
    ) : null;

  return { primary, overflowChip };
}
