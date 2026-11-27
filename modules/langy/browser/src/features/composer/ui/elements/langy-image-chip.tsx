import { Box, chakra } from "@langwatch/design-system/primitives";
import { Image as ImageIcon } from "lucide-react";

import { fileNameOfLabel, MARKER_GLYPH } from "../../model/langy-image-markers.ts";

const CHIP_SKIN = {
  borderRadius: "4px",
  background: "orange.subtle",
  color: "orange.fg",
} as const;

/**
 * An image chip drawn over the composer's text. `label` is the text the field holds for it,
 * `[▣ name.png]`: every character stays in place so the caret lines up, and the brackets and
 * glyph sit hidden under the icon.
 */
export function LangyDraftImageChip({ label }: { label: string }) {
  return (
    <chakra.span
      data-testid="langy-draft-image-chip"
      position="relative"
      // A ring of the same tint pads the chip without moving a character.
      boxShadow="0 0 0 2px var(--chakra-colors-orange-subtle)"
      {...CHIP_SKIN}
    >
      <chakra.span color="transparent">{label.slice(0, 1)}</chakra.span>
      <chakra.span position="relative" color="transparent">
        {label.slice(1, 1 + MARKER_GLYPH.length)}
        <Box
          as="span"
          position="absolute"
          inset={0}
          display="grid"
          placeItems="center"
          color="orange.fg"
        >
          <ImageIcon size="0.95em" aria-hidden />
        </Box>
      </chakra.span>
      <chakra.span>{label.slice(1 + MARKER_GLYPH.length, -1)}</chakra.span>
      <chakra.span color="transparent">{label.slice(-1)}</chakra.span>
    </chakra.span>
  );
}

/** An image's chip inside a sent message, at the place it was written. */
export function LangyInlineImageChip({ label }: { label: string }) {
  return (
    <chakra.span
      data-testid="langy-message-image-chip"
      display="inline-flex"
      alignItems="center"
      gap={1}
      paddingX={1}
      fontWeight="medium"
      verticalAlign="baseline"
      {...CHIP_SKIN}
    >
      <ImageIcon size="0.9em" aria-hidden />
      <chakra.span>{fileNameOfLabel(label)}</chakra.span>
    </chakra.span>
  );
}
