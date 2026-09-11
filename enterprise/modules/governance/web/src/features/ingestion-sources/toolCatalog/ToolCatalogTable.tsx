// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import { Badge, HStack, Table, Text, VStack } from "@chakra-ui/react";
import type { ReactNode } from "react";

import { ListTable } from "~/components/ui/ListTable";

import { ToolCardFigure, ToolCardMark } from "./ToolCardFigure";
import {
  TOOL_CARD_ROW_META,
  type ToolCard,
  type ToolCardRow,
  toolCardMissingReason,
} from "./toolCards";

/**
 * The catalog as a table: one row per tool, one column per figure.
 *
 * This is what the list layout is for. Stacking the grid card in a single
 * column spent a widescreen on one tool and left the reader scrolling to
 * compare two — the comparison being the only reason to ask for a list.
 *
 * WHICH COLUMNS, AND WHY NOT ALL OF THEM. A table pays for every column in
 * width, and the rows a tool has vary by how it is paid for, so listing all
 * eleven would give most tools a line of dashes. The seven here are the ones a
 * renewal turns on: how many seats and what they cost, how many of them nobody
 * uses, how many people are on a plan instead, what it spent, how many agents
 * it runs and which department drove it. The rest stay on the card, which has
 * the room and draws only the rows that tool actually has.
 *
 * HEADERS ARE SPELLED OUT. "Licence per month", not "Licence / mo"; "Usage ·
 * 30 days", not "Usage · 30d". A shortened header saves a few pixels and costs
 * the reader a guess, and this is the screen where a wrong guess about a money
 * column is expensive. Where that makes the table wider than the pane, the
 * body scrolls sideways rather than the words shrinking.
 *
 * Spec: specs/ai-governance/dashboard/inventory-catalog.feature
 */

/**
 * The figures the table has room for, in reading order: what it costs, then
 * what it did, then who did it.
 */
export const TOOL_TABLE_COLUMNS: readonly ToolCardRow[] = [
  "seats",
  "licencePerMonth",
  "idlePerMonth",
  "subscriptions",
  "usage30Days",
  "agents",
  "topDepartment",
];

export function ToolCatalogTable({
  cards,
  renderActions,
}: {
  cards: readonly ToolCard[];
  renderActions?: (card: ToolCard) => ReactNode;
}) {
  return (
    <ListTable
      size="sm"
      data-testid="tool-catalog-cards"
      data-layout="list"
      containerProps={{ overflowX: "auto", width: "full" }}
    >
      <Table.Header>
        <Table.Row>
          <Table.ColumnHeader>Tool</Table.ColumnHeader>
          {TOOL_TABLE_COLUMNS.map((row) => (
            <Table.ColumnHeader key={row} whiteSpace="nowrap">
              {TOOL_CARD_ROW_META[row].label}
            </Table.ColumnHeader>
          ))}
          {/* The overflow menu's column carries no header: naming it would
              label a control rather than a figure. */}
          <Table.ColumnHeader />
        </Table.Row>
      </Table.Header>
      <Table.Body>
        {cards.map((card) => (
          <Table.Row key={card.id} data-testid={`tool-card-${card.id}`}>
            <Table.Cell>
              <HStack gap={2.5} align="center">
                <ToolCardMark card={card} />
                <VStack gap={0} align="start" minWidth={0}>
                  <HStack gap={1.5}>
                    <Text fontSize="sm" fontWeight="medium" lineHeight="1.2">
                      {card.name}
                    </Text>
                    {card.isSample && (
                      <Badge size="xs" colorPalette="orange" variant="surface">
                        sample
                      </Badge>
                    )}
                    {card.enabled === false && (
                      <Badge size="xs" variant="surface" colorPalette="gray">
                        not published
                      </Badge>
                    )}
                  </HStack>
                  <Text fontSize="xs" color="fg.muted">
                    {card.vendor}
                  </Text>
                </VStack>
              </HStack>
            </Table.Cell>
            {TOOL_TABLE_COLUMNS.map((row) => (
              <Table.Cell key={row} whiteSpace="nowrap">
                <ToolCardFigure
                  label={TOOL_CARD_ROW_META[row].label}
                  // A column the tool has no row for is empty here rather
                  // than missing, because a table's columns are fixed. The
                  // dash says which of the two emptinesses it is.
                  value={card.values[row]}
                  emptyReason={toolCardMissingReason(card, row)}
                  align="start"
                />
              </Table.Cell>
            ))}
            <Table.Cell textAlign="end">{renderActions?.(card)}</Table.Cell>
          </Table.Row>
        ))}
      </Table.Body>
    </ListTable>
  );
}
