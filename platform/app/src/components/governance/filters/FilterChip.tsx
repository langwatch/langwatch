import { Button, HStack, Text } from "@chakra-ui/react";
import { ArrowUpDown, ChevronDown } from "lucide-react";
import type { ReactNode } from "react";

import { MenuContent, MenuRoot, MenuTrigger } from "~/components/ui/menu";

/**
 * The one shape a choice takes on a governance page: a pill that names the
 * thing it filters and the value currently picked, opening a menu.
 *
 * Extracted from the Costs filter bar, unchanged, because five more pages were
 * about to draw the same control five more ways. A native `<select>` is never
 * one of them — it cannot carry the icon, the label-plus-value reading, or the
 * app's own palette, and it renders as the operating system's widget in the
 * middle of our own. Where a menu genuinely will not do, use
 * `~/components/ui/select`; the rule is written down in
 * specs/ai-governance/dashboard/governance-ui-controls.feature.
 *
 * Every chip must change what the page renders. A chip that only looked like a
 * filter would be worse than no chip at all.
 */
export function FilterChip({
  icon,
  label,
  value,
  children,
  disabled,
}: {
  icon: ReactNode;
  /** What is being chosen, e.g. "Department". Spelled out, never abbreviated. */
  label: string;
  /** The current choice, as the reader would say it. */
  value: string;
  /** `MenuItem`s from `~/components/ui/menu`. */
  children: ReactNode;
  /** For a chip whose choices cannot apply to the current view. */
  disabled?: boolean;
}) {
  return (
    <MenuRoot>
      <MenuTrigger asChild>
        <Button
          size="xs"
          variant="outline"
          borderRadius="full"
          paddingX={3}
          fontWeight="normal"
          colorPalette="purple"
          disabled={disabled}
        >
          <HStack gap={1.5}>
            {icon}
            <Text color="fg.muted">{label}</Text>
            <Text color="fg.muted">·</Text>
            <Text fontWeight="medium">{value}</Text>
            <ChevronDown size={12} />
          </HStack>
        </Button>
      </MenuTrigger>
      <MenuContent minWidth="180px">{children}</MenuContent>
    </MenuRoot>
  );
}

/**
 * The row the chips sit in: one row, directly under the page header, holding
 * every filter AND the sort control together.
 *
 * Wrapping rather than scrolling, so a narrow window loses no chip. Sort lives
 * here with the filters on purpose — splitting them puts two controls that
 * change the same table on opposite sides of the screen.
 */
export function FilterChipRow({ children }: { children: ReactNode }) {
  return (
    <HStack gap={2} wrap="wrap">
      {children}
    </HStack>
  );
}

/**
 * A `FilterChip` labelled "Sort". Its own component only so the label and the
 * icon cannot drift between pages — a page that called it "Order by" would
 * read as a different control doing a different thing.
 */
export function SortChip({
  value,
  children,
  disabled,
}: {
  value: string;
  children: ReactNode;
  disabled?: boolean;
}) {
  return (
    <FilterChip
      icon={<ArrowUpDown size={12} />}
      label="Sort"
      value={value}
      disabled={disabled}
    >
      {children}
    </FilterChip>
  );
}
