// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import { Button, HStack, Text } from "@chakra-ui/react";
import { ArrowUpDown, ChevronDown } from "lucide-react";
import type { ReactNode } from "react";

import { Menu } from "@langwatch/design-system/menu";

/**
 * The one shape a choice takes on a governance page: a pill that names the
 * thing it filters and the value currently picked, opening a menu. Never a
 * native `<select>` — it cannot carry the icon, the label-plus-value reading,
 * or the app's own palette.
 *
 * Spec: specs/ai-governance/dashboard/governance-ui-controls.feature
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
  /** `Menu.Item`s from `@langwatch/design-system/menu`. */
  children: ReactNode;
  /** For a chip whose choices cannot apply to the current view. */
  disabled?: boolean;
}) {
  return (
    <Menu.Root>
      <Menu.Trigger asChild>
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
      </Menu.Trigger>
      <Menu.Content minWidth="180px">{children}</Menu.Content>
    </Menu.Root>
  );
}

/**
 * The row the chips sit in: one row, directly under the page header, holding
 * every filter AND the sort control together — splitting them puts two
 * controls that change the same table on opposite sides of the screen.
 */
export function FilterChipRow({ children }: { children: ReactNode }) {
  return (
    <HStack gap={2} wrap="wrap">
      {children}
    </HStack>
  );
}

/**
 * A `FilterChip` labelled "Sort", so the label and the icon cannot drift
 * between pages.
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
