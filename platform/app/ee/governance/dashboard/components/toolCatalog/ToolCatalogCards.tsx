// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import { Badge, Box, HStack, SimpleGrid, Text } from "@chakra-ui/react";
import type { ReactNode } from "react";

import { ToolCardFigure, ToolCardMark } from "./ToolCardFigure";
import { ToolCatalogTable } from "./ToolCatalogTable";
import {
  TOOL_CARD_BADGE_LABEL,
  TOOL_CARD_ROW_META,
  type ToolCard,
  toolCardMissingReason,
} from "./toolCards";

/**
 * The registered-tools catalog, drawn.
 *
 * Two layouts over one list, and they are genuinely different components. A
 * grid of tiles is for scanning the estate — one tool at a time, every row it
 * has, stacked. A list is for reading one tool's figures against the next, and
 * that is a table: same question asked of every row, one column per answer.
 * The list used to be the same tall card in a single column, which spent the
 * whole width on one tool and made the comparison the list exists for
 * impossible.
 *
 * A CARD DRAWS ONLY THE ROWS ITS TOOL HAS. The table cannot do that — its
 * columns are fixed for every row — so a cell for a row the tool does not have
 * draws an em dash saying exactly that. Both dashes go through the same
 * figure component, so neither layout can quietly drop the sentence behind it.
 *
 * Spec: specs/ai-governance/dashboard/inventory-catalog.feature
 */

export type ToolCatalogLayout = "grid" | "list";

/** The per-tool overflow menu, when the reader may act on the tool. */
export type ToolCardActions = (card: ToolCard) => ReactNode;

export function ToolCatalogCard({
  card,
  renderActions,
}: {
  card: ToolCard;
  renderActions?: ToolCardActions;
}) {
  const actions = renderActions?.(card);
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
        {card.isSample && (
          <Badge size="xs" colorPalette="orange" variant="surface">
            sample
          </Badge>
        )}
        {actions}
      </HStack>

      {(card.badges.length > 0 || card.enabled === false) && (
        <HStack gap={1.5} wrap="wrap">
          {card.badges.map((badge) => (
            <Badge key={badge} size="xs" variant="surface" colorPalette="gray">
              {TOOL_CARD_BADGE_LABEL[badge]}
            </Badge>
          ))}
          {/* Registered but not published, so nobody can launch it. Said on
              the card because an inventory that hid it would report a tool
              the organization is paying for as one it is using. */}
          {card.enabled === false && (
            <Badge size="xs" variant="surface" colorPalette="gray">
              not published
            </Badge>
          )}
        </HStack>
      )}

      <Box
        display="flex"
        flexDirection="column"
        gap={1.5}
        borderTopWidth="1px"
        borderColor="border.subtle"
        paddingTop={3}
      >
        {card.applicableRows.map((row) => (
          <HStack key={row} justify="space-between" gap={3} width="full">
            <Text fontSize="xs" color="fg.muted" flexShrink={0}>
              {TOOL_CARD_ROW_META[row].label}
            </Text>
            <ToolCardFigure
              label={TOOL_CARD_ROW_META[row].label}
              value={card.values[row]}
              emptyReason={toolCardMissingReason(card, row)}
            />
          </HStack>
        ))}
      </Box>
    </Box>
  );
}

/**
 * The catalog, in whichever layout the reader picked.
 *
 * One entry point rather than two, so the pane picks a layout and nothing
 * else: the choice of grid or table is the only difference between them, and
 * pushing it up to the pane would put the same branch in three callers.
 */
export function ToolCatalogCards({
  cards,
  layout,
  renderActions,
}: {
  cards: readonly ToolCard[];
  layout: ToolCatalogLayout;
  renderActions?: ToolCardActions;
}) {
  if (layout === "list") {
    return <ToolCatalogTable cards={cards} renderActions={renderActions} />;
  }

  return (
    <SimpleGrid
      data-testid="tool-catalog-cards"
      data-layout={layout}
      columns={{ base: 1, md: 2, xl: 3 }}
      gap={4}
      width="full"
    >
      {cards.map((card) => (
        <ToolCatalogCard
          key={card.id}
          card={card}
          renderActions={renderActions}
        />
      ))}
    </SimpleGrid>
  );
}
