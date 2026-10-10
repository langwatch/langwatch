// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import { Circle, Text } from "@langwatch/design-system/primitives";
import { Tooltip } from "@langwatch/design-system/tooltip";

import { TileIcon } from "../../ai-tools/ui/elements/tile-icon.tsx";
import { SourceTypeIconGlyph } from "../ui/elements/source-type-icon-glyph.tsx";
import { exactCardCount, formatCardCount, type ToolCard, toolInitials } from "./tool-cards";

/** Missing metrics keep a focusable explanation; a dash is never a measured zero. */
export function ToolCardFigure({
  label,
  value,
  emptyReason,
  align = "end",
}: {
  label: string;
  value: string | number | undefined;
  /** Why the metric is missing when `value` is absent. Never optional. */
  emptyReason: string;
  align?: "start" | "end";
}) {
  // A count arrives as a number and is shortened here; anything already shaped
  // for reading arrives as the string it should show.
  const compact = typeof value === "number" ? formatCardCount(value) : undefined;
  const exact = typeof value === "number" ? exactCardCount(value) : undefined;

  if (value === undefined) {
    return (
      <Tooltip content={emptyReason} showArrow positioning={{ placement: "top" }}>
        <Text
          fontSize="xs"
          fontWeight="normal"
          color="fg.subtle"
          cursor="help"
          tabIndex={0}
          textAlign={align}
          aria-label={`${label} not measured. ${emptyReason}`}
        >
          —
        </Text>
      </Tooltip>
    );
  }

  if (compact !== undefined && exact !== undefined) {
    // Shortened on the card, exact on hover and to a screen reader: the
    // compact form is a reading aid, never the only place the figure lives.
    return (
      <Tooltip content={`${exact} exactly`} showArrow positioning={{ placement: "top" }}>
        <Text
          fontSize="sm"
          fontWeight="medium"
          color="fg"
          fontVariantNumeric="tabular-nums"
          textAlign={align}
          cursor="help"
          aria-label={`${label}: ${exact}`}
        >
          {compact}
        </Text>
      </Tooltip>
    );
  }

  return (
    <Text
      fontSize="sm"
      fontWeight="medium"
      color="fg"
      fontVariantNumeric="tabular-nums"
      textAlign={align}
    >
      {value}
    </Text>
  );
}

/**
 * The tool's mark: the registry tile's own icon for a registered tool, the
 * vendor glyph for a sample card that names a source type, and initials when
 * neither exists.
 */
export function ToolCardMark({ card, size = 20 }: { card: ToolCard; size?: number }) {
  if (card.tile) {
    return <TileIcon iconAsset={card.tile.iconAsset} type={card.tile.type} size={size} />;
  }
  if (card.sourceType) {
    return <SourceTypeIconGlyph sourceType={card.sourceType} size={`${size}px`} />;
  }
  return (
    <Circle
      size={`${size}px`}
      background="bg.emphasized"
      color="fg.muted"
      fontSize="9px"
      fontWeight="bold"
      flexShrink={0}
    >
      {toolInitials(card.name)}
    </Circle>
  );
}
