/**
 * One direction of a project's braids: the other project, the condition, access dates, activity and
 * the row menu. It reads nothing; rows and what the viewer may do arrive as props.
 * Spec: modules/authz/specs/braids-screen.feature, "The list shows each braid and what it does".
 */

import { Link } from "@langwatch/browser-host/link";
import { FormattedNumber } from "@langwatch/design-system/formatted-number";
import { MoreVerticalIcon } from "@langwatch/design-system/icons";
import { ListTable } from "@langwatch/design-system/list-table";
import { Menu } from "@langwatch/design-system/menu";
import { Badge, Box, Button, Text } from "@langwatch/design-system/primitives";
import { Pause } from "lucide-react";

import { type BraidRow, type BraidSide, braidAuditHref } from "../../../model/braids/braids.ts";
import { BraidCondition } from "../../elements/braid-condition.tsx";
import { BraidProjectLabel } from "../../elements/braid-project.tsx";
import { BRAID_WINDOW_HEADER, BraidCreated, BraidWindow } from "../../elements/braid-window.tsx";

export type BraidsTableProps = {
  side: BraidSide;
  /** The page's own project, which the audit log names beside the other one. */
  projectName: string;
  /** The page's own project's slug: the audit log opens in the project that owns the braid. */
  projectSlug?: string | undefined;
  rows: readonly BraidRow[];
  paused: boolean;
  canEdit: boolean;
  canRemove: boolean;
  /** Spans per braid over the last 24 hours; undefined while counting. */
  activity: ReadonlyMap<string, number> | undefined;
  onEdit: (row: BraidRow) => void;
  onRemove: (row: BraidRow) => void;
};

/** The Last 24 hours cell: the one place a paused row says so. */
function Activity({ paused, spans }: { paused: boolean; spans: number | undefined }) {
  if (paused) {
    return (
      <Badge size="sm" colorPalette="gray" width="fit-content" data-testid="braid-paused">
        <Pause size={12} aria-hidden />
        Paused
      </Badge>
    );
  }
  return (
    <Text textStyle="sm" color="fg.muted" data-testid="braid-activity">
      {spans === undefined ? (
        "Counting spans"
      ) : (
        <>
          <FormattedNumber value={spans} /> {spans === 1 ? "span" : "spans"}
        </>
      )}
    </Text>
  );
}

function auditHref({
  row,
  projectName,
  projectSlug,
}: {
  row: BraidRow;
  projectName: string;
  projectSlug: string | undefined;
}): string {
  if (row.side === "into") {
    return braidAuditHref({
      braidId: row.braidId,
      ownerName: projectName,
      readerName: row.otherProject.name,
      ownerSlug: projectSlug,
    });
  }
  return braidAuditHref({
    braidId: row.braidId,
    ownerName: row.otherProject.name,
    readerName: projectName,
    ownerSlug: row.otherProject.slug,
  });
}

function rowName(row: BraidRow): string {
  return row.side === "into"
    ? `braid into ${row.otherProject.name}`
    : `braid from ${row.otherProject.name}`;
}

export function BraidsTable({
  side,
  projectName,
  projectSlug,
  rows,
  paused,
  canEdit,
  canRemove,
  activity,
  onEdit,
  onRemove,
}: BraidsTableProps) {
  const label = side === "into" ? "Braids into other projects" : "Braids from other projects";
  return (
    <ListTable scroll="x" scrollLabel={label} aria-label={label}>
      <ListTable.Header>
        <ListTable.Row>
          <ListTable.ColumnHeader>
            {side === "into" ? "Braided into" : "Braided from"}
          </ListTable.ColumnHeader>
          <ListTable.ColumnHeader>Condition</ListTable.ColumnHeader>
          <ListTable.ColumnHeader>{BRAID_WINDOW_HEADER}</ListTable.ColumnHeader>
          <ListTable.ColumnHeader>Last 24 hours</ListTable.ColumnHeader>
          <ListTable.ActionHeader />
        </ListTable.Row>
      </ListTable.Header>
      <ListTable.Body>
        {rows.map((row) => (
          <ListTable.Row
            key={row.braidId}
            data-testid="braid-row"
            data-paused={paused || undefined}
          >
            <ListTable.Cell>
              <BraidProjectLabel
                project={row.otherProject}
                detail={<BraidCreated atMs={row.createdAtMs} />}
              />
            </ListTable.Cell>
            <ListTable.Cell>
              <Box maxWidth="24rem">
                <BraidCondition where={row.where} />
              </Box>
            </ListTable.Cell>
            <ListTable.Cell nowrap>
              <BraidWindow
                fromMs={row.fromMs}
                fromShowsTime={row.fromShowsTime}
                expiresAtMs={row.expiresAtMs}
              />
            </ListTable.Cell>
            <ListTable.Cell nowrap>
              <Activity paused={paused} spans={activity?.get(row.braidId)} />
            </ListTable.Cell>
            <ListTable.ActionCell>
              <Menu.Root>
                <Menu.Trigger asChild>
                  <Button
                    size="xs"
                    variant="ghost"
                    aria-label={`Actions for the ${rowName(row)}`}
                    data-testid="braid-row-actions"
                  >
                    <MoreVerticalIcon size={14} aria-hidden />
                  </Button>
                </Menu.Trigger>
                <Menu.Content>
                  {canEdit && row.side === "into" ? (
                    <Menu.Item value="edit" onClick={() => onEdit(row)} data-testid="braid-edit">
                      Edit
                    </Menu.Item>
                  ) : null}
                  <Menu.Item value="audit" asChild data-testid="braid-audit">
                    <Link href={auditHref({ row, projectName, projectSlug })}>
                      View in audit log
                    </Link>
                  </Menu.Item>
                  {canRemove ? (
                    <Menu.Item
                      value="remove"
                      color="red.fg"
                      onClick={() => onRemove(row)}
                      data-testid="braid-remove"
                    >
                      Remove braid
                    </Menu.Item>
                  ) : null}
                </Menu.Content>
              </Menu.Root>
            </ListTable.ActionCell>
          </ListTable.Row>
        ))}
      </ListTable.Body>
    </ListTable>
  );
}
