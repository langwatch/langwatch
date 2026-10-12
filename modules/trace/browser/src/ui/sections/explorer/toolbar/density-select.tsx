import {
  MenuContent,
  MenuRadioItem,
  MenuRadioItemGroup,
  MenuRoot,
  MenuTrigger,
} from "@langwatch/design-system/menu";
import { Box, Button, HStack, Text, VStack } from "@langwatch/design-system/primitives";
import { shortcutAriaKeys } from "@langwatch/design-system/shortcut-hint";
import { Tooltip } from "@langwatch/design-system/tooltip";
import { TriggerAnchor } from "@langwatch/design-system/trigger-anchor";
import { ChevronDown, Rows2, Rows4 } from "lucide-react";
import type React from "react";

import {
  type Density,
  useDensityStore,
} from "../../../../features/explorer/behavior/density.store.ts";
import { PAGE_SHORTCUTS } from "../traces-page/page-keyboard-shortcuts.tsx";

// What each density changes, in the reader's words: the menu is where people learn it.
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

const isDensity = (value: string): value is Density =>
  OPTIONS.some((option) => option.density === value);

/**
 * "Density: <X>" picker, styled like the Group by one beside it. When compact it keeps
 * only the current density's icon.
 */
export const DensitySelect: React.FC<{ compact?: boolean }> = ({ compact = false }) => {
  const density = useDensityStore((s) => s.density);
  const setDensity = useDensityStore((s) => s.setDensity);
  const current = OPTIONS.find((option) => option.density === density) ?? OPTIONS[1]!;
  const CurrentIcon = current.Icon;

  return (
    <MenuRoot positioning={{ placement: "bottom-start" }}>
      <Tooltip
        content={`${current.label} rows. ${current.hint}`}
        shortcut={PAGE_SHORTCUTS.density}
        positioning={{ placement: "bottom" }}
      >
        <TriggerAnchor>
          <MenuTrigger asChild>
            <Button
              size="xs"
              variant="outline"
              aria-label={`Density: ${current.label}`}
              aria-keyshortcuts={shortcutAriaKeys(PAGE_SHORTCUTS.density)}
              data-testid="trace-toolbar-density"
              gap={1}
              paddingX={2}
              flexShrink={0}
            >
              <CurrentIcon size={14} aria-hidden="true" />
              {!compact && (
                <>
                  <Text as="span" color="fg.muted" fontWeight="normal">
                    Density:
                  </Text>
                  {current.label}
                  <ChevronDown size={12} />
                </>
              )}
            </Button>
          </MenuTrigger>
        </TriggerAnchor>
      </Tooltip>
      <DensityMenuContent density={density} onSelect={setDensity} />
    </MenuRoot>
  );
};

const DensityMenuContent: React.FC<{
  density: Density;
  onSelect: (density: Density) => void;
}> = ({ density, onSelect }) => (
  <MenuContent minWidth="240px" maxWidth="280px">
    <MenuRadioItemGroup
      value={density}
      onValueChange={(e) => {
        if (isDensity(e.value)) onSelect(e.value);
      }}
    >
      {OPTIONS.map(({ density: value, label, hint, Icon }) => (
        <MenuRadioItem key={value} value={value}>
          <HStack align="flex-start" gap={2}>
            <Box paddingTop="3px" flexShrink={0}>
              <Icon size={14} aria-hidden="true" />
            </Box>
            <VStack align="start" gap={0.5}>
              <Text>{label}</Text>
              <Text textStyle="xs" color="fg.muted" whiteSpace="normal">
                {hint}
              </Text>
            </VStack>
          </HStack>
        </MenuRadioItem>
      ))}
    </MenuRadioItemGroup>
  </MenuContent>
);
