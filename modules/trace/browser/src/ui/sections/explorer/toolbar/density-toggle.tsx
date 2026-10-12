import { Text, VStack } from "@langwatch/design-system/primitives";
import { RawSegmentGroup as SegmentGroup } from "@langwatch/design-system/segmented-control";
import { shortcutAriaKeys } from "@langwatch/design-system/shortcut-hint";
import { Tooltip } from "@langwatch/design-system/tooltip";
import { Rows2, Rows4 } from "lucide-react";
import type React from "react";

import {
  type Density,
  useDensityStore,
} from "../../../../features/explorer/behavior/density.store.ts";
import { PAGE_SHORTCUTS } from "../traces-page/page-keyboard-shortcuts.tsx";

// What each density changes, in the reader's words: the tooltip is where people learn it.
const OPTIONS: { density: Density; label: string; hint: string; Icon: typeof Rows4 }[] = [
  {
    density: "compact",
    label: "Compact",
    hint: "More traces on screen: smaller text, tight rows, errors inline and every filter section.",
    Icon: Rows4,
  },
  {
    density: "comfortable",
    label: "Comfortable",
    hint: "Easier to read: larger text, labelled input and output, conversations as chat turns.",
    Icon: Rows2,
  },
];

const isDensity = (value: string | null): value is Density =>
  OPTIONS.some((option) => option.density === value);

/** Compact or comfortable rows, both always visible; labels drop when the bar is compact. */
export const DensityToggle: React.FC<{ compact?: boolean }> = ({ compact = false }) => {
  const density = useDensityStore((s) => s.density);
  const setDensity = useDensityStore((s) => s.setDensity);

  return (
    <SegmentGroup.Root
      size="xs"
      value={density}
      aria-label="Row density"
      aria-keyshortcuts={shortcutAriaKeys(PAGE_SHORTCUTS.density)}
      data-testid="trace-toolbar-density"
      onValueChange={({ value }) => {
        if (isDensity(value)) setDensity(value);
      }}
    >
      <SegmentGroup.Indicator />
      {OPTIONS.map(({ density: value, label, hint, Icon }) => (
        <Tooltip
          key={value}
          content={
            <VStack align="start" gap={1} maxWidth="240px">
              <Text fontWeight="semibold">{label}</Text>
              <Text>{hint}</Text>
            </VStack>
          }
          shortcut={PAGE_SHORTCUTS.density}
          positioning={{ placement: "bottom" }}
        >
          <SegmentGroup.Item value={value} cursor="pointer" paddingX={compact ? 1.5 : 2}>
            <Icon size={14} aria-hidden="true" />
            <SegmentGroup.ItemText>
              {compact ? <Text srOnly>{label}</Text> : label}
            </SegmentGroup.ItemText>
            <SegmentGroup.ItemHiddenInput />
          </SegmentGroup.Item>
        </Tooltip>
      ))}
    </SegmentGroup.Root>
  );
};
