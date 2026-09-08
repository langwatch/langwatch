// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import { Badge, Box, Circle, HStack, SimpleGrid, Text } from "@chakra-ui/react";

import { Tooltip } from "~/components/ui/tooltip";

import { SourceTypeIconGlyph } from "../ingestionSourceCatalog";
import {
  exactCardCount,
  formatCardCount,
  TOOL_CARD_BADGE_LABEL,
  TOOL_CARD_ROW_META,
  TOOL_CARD_ROWS,
  type ToolCard,
  toolInitials,
} from "./toolCards";

/**
 * The registered-tools catalog, drawn.
 *
 * Two layouts over one card: a grid of tiles for scanning the estate, and a
 * single-column list for reading one tool's figures against the next. The
 * layout choice changes nothing about what a card says — which is the point of
 * keeping the card itself layout-agnostic.
 *
 * Spec: specs/ai-governance/dashboard/inventory-catalog.feature
 */

export type ToolCatalogLayout = "grid" | "list";

/**
 * One figure on a card.
 *
 * An absent value draws an em dash carrying the sentence that says what would
 * fill it. Rendering the dash as a `Tooltip` trigger rather than a `title=`
 * attribute is deliberate: the sentences are the honest half of this screen
 * and they have to survive on touch, where `title` never opens.
 */
function ToolCardMetric({
  label,
  value,
  filledBy,
}: {
  label: string;
  value: string | number | undefined;
  filledBy: string;
}) {
  // A count arrives as a number and is shortened here; anything already shaped
  // for reading arrives as the string it should show.
  const compact =
    typeof value === "number" ? formatCardCount(value) : undefined;
  const exact = typeof value === "number" ? exactCardCount(value) : undefined;

  return (
    <HStack justify="space-between" gap={3} width="full">
      <Text fontSize="xs" color="fg.muted" flexShrink={0}>
        {label}
      </Text>
      {value === undefined ? (
        <Tooltip
          content={filledBy}
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
            aria-label={`${label} not measured. ${filledBy}`}
          >
            —
          </Text>
        </Tooltip>
      ) : compact !== undefined && exact !== undefined ? (
        // Shortened on the card, exact on hover and to a screen reader: the
        // compact form is a reading aid, never the only place the figure lives.
        <Tooltip
          content={`${exact} exactly`}
          showArrow
          positioning={{ placement: "top" }}
        >
          <Text
            fontSize="xs"
            fontWeight="medium"
            fontVariantNumeric="tabular-nums"
            textAlign="end"
            cursor="help"
            aria-label={`${label}: ${exact}`}
          >
            {compact}
          </Text>
        </Tooltip>
      ) : (
        <Text
          fontSize="xs"
          fontWeight="medium"
          fontVariantNumeric="tabular-nums"
          textAlign="end"
        >
          {value}
        </Text>
      )}
    </HStack>
  );
}

/** The vendor's own mark where we ship one, and initials where we do not. */
function ToolCardMark({ card }: { card: ToolCard }) {
  if (card.sourceType) {
    return <SourceTypeIconGlyph sourceType={card.sourceType} size="20px" />;
  }
  return (
    <Circle
      size="20px"
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

export function ToolCatalogCard({ card }: { card: ToolCard }) {
  return (
    <Box
      data-testid={`tool-card-${card.id}`}
      borderWidth="1px"
      borderColor="border.muted"
      borderRadius="md"
      padding={4}
      background="bg.panel"
      display="flex"
      flexDirection="column"
      gap={3}
    >
      <HStack gap={2.5} align="start">
        <ToolCardMark card={card} />
        <Box flex="1" minWidth={0}>
          <Text fontSize="sm" fontWeight="semibold" lineHeight="1.2">
            {card.name}
          </Text>
          <Text fontSize="xs" color="fg.muted">
            {card.vendor}
          </Text>
        </Box>
        {card.sample && (
          <Badge size="xs" colorPalette="orange" variant="surface">
            sample
          </Badge>
        )}
      </HStack>

      <HStack gap={1.5} wrap="wrap">
        {card.badges.map((badge) => (
          <Badge key={badge} size="xs" variant="surface" colorPalette="gray">
            {TOOL_CARD_BADGE_LABEL[badge]}
          </Badge>
        ))}
      </HStack>

      <Box
        display="flex"
        flexDirection="column"
        gap={1.5}
        borderTopWidth="1px"
        borderColor="border.subtle"
        paddingTop={3}
      >
        {TOOL_CARD_ROWS.map((row) => (
          <ToolCardMetric
            key={row}
            label={TOOL_CARD_ROW_META[row].label}
            value={card.values[row]}
            filledBy={TOOL_CARD_ROW_META[row].filledBy}
          />
        ))}
      </Box>
    </Box>
  );
}

/**
 * The cards, laid out.
 *
 * `SimpleGrid` in both modes rather than a second component: the list is one
 * column of the same card, so the two layouts cannot drift apart in anything
 * but width.
 */
export function ToolCatalogCards({
  cards,
  layout,
}: {
  cards: readonly ToolCard[];
  layout: ToolCatalogLayout;
}) {
  return (
    <SimpleGrid
      data-testid="tool-catalog-cards"
      data-layout={layout}
      columns={layout === "grid" ? { base: 1, md: 2, xl: 3 } : 1}
      gap={4}
      width="full"
    >
      {cards.map((card) => (
        <ToolCatalogCard key={card.id} card={card} />
      ))}
    </SimpleGrid>
  );
}
