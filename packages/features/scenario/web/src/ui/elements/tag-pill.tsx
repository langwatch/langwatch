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
 * `pastel` gives each label a colour of its own, so a row of labels can be
 * told apart at a glance. A pastel pill is drawn in the monospace face, which
 * is what tells a label from the words of the row it sits in.
 */
export type TagPillTone = "neutral" | "pastel";

/**
 * The hues a pastel pill can take, as oklch hue angles: blue, green, orange,
 * purple, pink, cyan and olive.
 */
const PASTEL_HUES = [230, 160, 20, 280, 330, 200, 60] as const;

/**
 * The hue a label always takes. The same label keeps its colour across rows,
 * pages and reloads because the colour is read from the text itself.
 */
export function pastelHueForLabel(label: string): number {
  let hash = 0;
  for (let index = 0; index < label.length; index++) {
    hash = (hash * 31 + label.charCodeAt(index)) >>> 0;
  }
  return PASTEL_HUES[hash % PASTEL_HUES.length]!;
}

/**
 * The colour of the dot that stands for a label where no pill is drawn, in the
 * label filter. One step stronger than the pill's ground, so a 10px dot still
 * carries its hue.
 */
/**
 * The two colours of a pill, at one hue.
 *
 * Lightness and chroma are fixed and only the hue moves, so every label reads
 * at the same strength and the same contrast: a pale ground and text dark
 * enough to read on it. On a dark page the two swap roles.
 */
export function pastelSwatchColor(label: string): string {
  return `oklch(0.62 0.14 ${pastelHueForLabel(label)})`;
}

function pastelColors(hue: number) {
  return {
    background: {
      base: `oklch(0.95 0.035 ${hue})`,
      _dark: `oklch(0.28 0.05 ${hue})`,
    },
    foreground: {
      base: `oklch(0.42 0.09 ${hue})`,
      _dark: `oklch(0.86 0.07 ${hue})`,
    },
  };
}

type TagPillProps = {
  label: string;
  onRemove?: () => void;
  tone?: TagPillTone;
};

export function TagPill({ label, onRemove, tone = "neutral" }: TagPillProps) {
  const colors = tone === "pastel" ? pastelColors(pastelHueForLabel(label)) : null;

  return (
    <HStack
      gap={1}
      bg={colors ? colors.background : "bg.muted"}
      color={colors ? colors.foreground : undefined}
      px={2}
      py={colors ? "1px" : 0.5}
      borderRadius="full"
      fontSize="xs"
      fontFamily={colors ? "mono" : undefined}
      data-testid={`tag-pill-${label}`}
    >
      <Text fontSize={colors ? "10px" : "xs"} fontWeight={colors ? "medium" : undefined}>
        {label}
      </Text>
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
