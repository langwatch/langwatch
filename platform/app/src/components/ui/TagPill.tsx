/**
 * Lovable-style tag pill component for displaying a single label.
 *
 * Renders a rounded pill with optional remove button.
 */

import { chakra, HStack, Text } from "@chakra-ui/react";
import { X } from "lucide-react";

const StyledButton = chakra("button");

/**
 * How a pill is coloured. `neutral` is one muted grey for every label.
 * `pastel` gives each label a soft colour of its own, so a row of labels can
 * be told apart at a glance.
 */
export type TagPillTone = "neutral" | "pastel";

/**
 * The colours a pastel pill can take. Every entry is a Chakra palette, so the
 * pill follows the light and the dark theme without a second definition.
 */
const PASTEL_PALETTES = [
  "blue",
  "purple",
  "teal",
  "pink",
  "orange",
  "cyan",
  "green",
  "yellow",
] as const;

/**
 * The palette a label always takes. The same label keeps its colour across
 * rows, pages and reloads because the colour is read from the text itself.
 */
export function pastelPaletteForLabel(label: string): string {
  let hash = 0;
  for (let index = 0; index < label.length; index++) {
    hash = (hash * 31 + label.charCodeAt(index)) >>> 0;
  }
  return PASTEL_PALETTES[hash % PASTEL_PALETTES.length]!;
}

type TagPillProps = {
  label: string;
  onRemove?: () => void;
  tone?: TagPillTone;
};

export function TagPill({ label, onRemove, tone = "neutral" }: TagPillProps) {
  const palette = tone === "pastel" ? pastelPaletteForLabel(label) : null;

  return (
    <HStack
      gap={1}
      bg={palette ? `${palette}.subtle` : "bg.muted"}
      color={palette ? `${palette}.fg` : undefined}
      px={2}
      py={0.5}
      borderRadius="full"
      fontSize="xs"
      data-testid={`tag-pill-${label}`}
    >
      <Text fontSize="xs">{label}</Text>
      {onRemove && (
        <StyledButton
          type="button"
          aria-label={`Remove ${label} tag`}
          onClick={(e: React.MouseEvent) => {
            e.stopPropagation();
            onRemove();
          }}
          display="flex"
          alignItems="center"
          cursor="pointer"
          color="fg.muted"
          _hover={{ color: "fg" }}
          background="transparent"
          border="none"
          padding={0}
        >
          <X size={12} />
        </StyledButton>
      )}
    </HStack>
  );
}
