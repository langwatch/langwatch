/**
 * One row of the `/dashboards` library's table: the board's name linking to it with its
 * description below, its product, who sees it, its owner, when it last changed and the board's
 * "⋮" menu (`board-menu.tsx`) with what this member may do.
 */

import { FormattedDate } from "@langwatch/design-system/formatted-date";
import { ListTable } from "@langwatch/design-system/list-table";
import { HStack, Text, VStack } from "@langwatch/design-system/primitives";
import { Lock } from "lucide-react";

import { useAnalyticsHost } from "../../../../model/analytics-host.ts";
import type { BoardMenuActions } from "../../model/organization-library.ts";
import { InlineTextField } from "../elements/inline-text-field.tsx";
import { BoardMenu } from "./board-menu.tsx";

/** The name edited in place: Enter or leaving the field saves it, Escape cancels. */
export type LibraryRowRenaming = { onCommit: (name: string) => void; onCancel: () => void };

/** The columns every row fills, in order, for the header to name. */
export const LIBRARY_COLUMNS = {
  product: { label: "Product", width: "9rem" },
  whoSees: { label: "Shared with", width: "11rem" },
  owner: { label: "Owner", width: "9rem" },
  updated: { label: "Updated", width: "8rem" },
} as const;

export function LibraryRow({
  name,
  description,
  href,
  product,
  whoSees,
  isPrivate = false,
  owner,
  updatedAt,
  actions,
  renaming,
}: {
  name: string;
  description: string | null;
  /** Absent when no project the member reads can open the board. */
  href: string | undefined;
  product: string;
  whoSees: string;
  isPrivate?: boolean;
  owner: string | undefined;
  updatedAt: string;
  actions: BoardMenuActions;
  renaming?: LibraryRowRenaming | undefined;
}) {
  return (
    <ListTable.Row>
      <ListTable.Cell minWidth="14rem">
        {renaming ? (
          <InlineTextField
            value={name}
            label="Dashboard name"
            size="xs"
            textStyle="bodySm"
            onCommit={renaming.onCommit}
            onCancel={renaming.onCancel}
          />
        ) : (
          <VStack align="start" gap={0.5} minWidth={0}>
            <NameCell name={name} href={href} />
            {description && (
              <Text textStyle="caption" color="fg.muted" lineClamp={1} title={description}>
                {description}
              </Text>
            )}
          </VStack>
        )}
      </ListTable.Cell>
      <ListTable.Cell tone="muted" truncate width={LIBRARY_COLUMNS.product.width}>
        {product}
      </ListTable.Cell>
      <ListTable.Cell tone="muted" width={LIBRARY_COLUMNS.whoSees.width} maxWidth="11rem">
        <HStack gap={1} minWidth={0}>
          {isPrivate && <Lock size={11} aria-label="Only me" />}
          <Text as="span" truncate title={whoSees}>
            {whoSees}
          </Text>
        </HStack>
      </ListTable.Cell>
      <ListTable.Cell tone="muted" truncate width={LIBRARY_COLUMNS.owner.width}>
        {owner}
      </ListTable.Cell>
      <ListTable.Cell tone="muted" nowrap width={LIBRARY_COLUMNS.updated.width}>
        <FormattedDate value={updatedAt} display="relative" />
      </ListTable.Cell>
      <ListTable.ActionCell>
        {/* Gone while renaming, so closing it cannot hand focus back and end the edit. */}
        {!renaming && <BoardMenu name={name} actions={actions} isAlwaysShown />}
      </ListTable.ActionCell>
    </ListTable.Row>
  );
}

/** The board's name, a link where it opens and plain text where it opens nowhere. */
function NameCell({ name, href }: { name: string; href: string | undefined }) {
  const host = useAnalyticsHost();
  if (!href) {
    return (
      <Text truncate fontWeight="medium" color="fg" title={name}>
        {name}
      </Text>
    );
  }
  return (
    <ListTable.RowAction href={href} onNavigate={() => host.navigate(href)}>
      {name}
    </ListTable.RowAction>
  );
}
