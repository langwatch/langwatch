// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import { Circle, Text } from "@chakra-ui/react";
import { TileIcon } from "@langwatch/user-web/surfaces/tile-icon";

import { Tooltip } from "@langwatch/design-system/tooltip";

import { SourceTypeIconGlyph } from "../ui/elements/source-type-icon-glyph.tsx";
import {
  exactCardCount,
  formatCardCount,
  type ToolCard,
  toolInitials,
} from "./toolCards";

/**
 * The two pieces the grid card and the list table both draw: one figure, and
 * one vendor mark.
 *
 * Shared rather than written twice, because the honesty rule lives inside the
 * figure. A table that drew its own dash would be one edit away from drawing a
 * bare "—" with no sentence behind it, and the sentence is the whole reason
 * the dash is acceptable.
 *
 * Spec: specs/ai-governance/dashboard/inventory-catalog.feature
 */

/**
 * One figure, wherever it is drawn.
 *
 * An absent value draws an em dash carrying the sentence that says why. Two
 * different sentences reach it — a row the tool has but nothing measures yet,
 * and a row the tool does not have at all — and the caller has already picked
 * which; see `toolCardMissingReason`. Rendering the dash as a `Tooltip`
 * trigger rather than a `title=` attribute is deliberate: the sentences are
 * the honest half of this screen and they have to survive on touch, where
 * `title` never opens.
 */
export function ToolCardFigure({
  label,
  value,
  emptyReason,
  align = "end",
}: {
  label: string;
  value: string | number | undefined;
  /** What the em dash says when `value` is absent. Never optional. */
  emptyReason: string;
  align?: "start" | "end";
}) {
  // A count arrives as a number and is shortened here; anything already shaped
  // for reading arrives as the string it should show.
  const compact =
    typeof value === "number" ? formatCardCount(value) : undefined;
  const exact = typeof value === "number" ? exactCardCount(value) : undefined;

  if (value === undefined) {
    return (
      <Tooltip
        content={emptyReason}
        showArrow
        positioning={{ placement: "top" }}
      >
        <Text
          fontSize="xs"
          color="fg.subtle"
          cursor="help"
          textDecoration="underline"
          textDecorationStyle="dotted"
          textUnderlineOffset="3px"
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
      <Tooltip
        content={`${exact} exactly`}
        showArrow
        positioning={{ placement: "top" }}
      >
        <Text
          fontSize="xs"
          fontWeight="medium"
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
      fontSize="xs"
      fontWeight="medium"
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
export function ToolCardMark({
  card,
  size = 20,
}: {
  card: ToolCard;
  size?: number;
}) {
  if (card.tile) {
    return (
      <TileIcon
        iconAsset={card.tile.iconAsset}
        type={card.tile.type}
        size={size}
      />
    );
  }
  if (card.sourceType) {
    return (
      <SourceTypeIconGlyph sourceType={card.sourceType} size={`${size}px`} />
    );
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
