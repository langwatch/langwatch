/**
 * One direction of a project's braids: the other project, the condition, access dates, activity and
 * the row menu. It reads nothing; rows and what the viewer may do arrive as props.
 * Spec: modules/authz/specs/braids-screen.feature, "The list shows each braid and what it does".
 */

import { Link } from "@langwatch/browser-host/link";
import { MoreVerticalIcon } from "@langwatch/design-system/icons";
import { ListTable } from "@langwatch/design-system/list-table";
import { Menu } from "@langwatch/design-system/menu";
import { Badge, Button, Stack, Text } from "@langwatch/design-system/primitives";
import { format } from "@langwatch/time";
import { Pause } from "lucide-react";

import {
  type BraidRow,
  type BraidSide,
  braidAuditHref,
  braidFromText,
} from "../../../model/braids/braids.ts";
import { BraidCondition } from "../../elements/braid-condition.tsx";
import { BraidProjectLabel } from "../../elements/braid-project.tsx";

export type BraidsTableProps = {
  side: BraidSide;
  rows: readonly BraidRow[];
  paused: boolean;
  canEdit: boolean;
  canRemove: boolean;
  /** Spans per braid over the last 24 hours; undefined while counting. */
  activity: ReadonlyMap<string, number> | undefined;
  onEdit: (row: BraidRow) => void;
  onRemove: (row: BraidRow) => void;
};

function activityText({ paused, spans }: { paused: boolean; spans: number | undefined }): string {
  if (paused) return "Paused";
  if (spans === undefined) return "Counting spans";
  return spans === 1 ? "1 span in 24h" : `${spans.toLocaleString("en-GB")} spans in 24h`;
}

function day(ms: number): string {
  return format(ms, "d MMM yyyy");
}

function rowName(row: BraidRow): string {
  return row.side === "into"
    ? `braid into ${row.otherProject.name}`
    : `braid from ${row.otherProject.name}`;
}

export function BraidsTable({
  side,
  rows,
  paused,
  canEdit,
  canRemove,
  activity,
  onEdit,
  onRemove,
}: BraidsTableProps) {
  return (
    <ListTable
      variant="embedded"
      aria-label={side === "into" ? "Braids into other projects" : "Braids from other projects"}
    >
      <ListTable.Header>
        <ListTable.Row>
          <ListTable.ColumnHeader>
            {side === "into" ? "Braided into" : "Braided from"}
          </ListTable.ColumnHeader>
          <ListTable.ColumnHeader>Condition</ListTable.ColumnHeader>
          <ListTable.ColumnHeader>Access</ListTable.ColumnHeader>
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
                detail={`Since ${day(row.createdAtMs)}`}
              />
            </ListTable.Cell>
            <ListTable.Cell>
              <BraidCondition where={row.where} />
            </ListTable.Cell>
            <ListTable.Cell>
              <Stack gap={1}>
                {paused ? (
                  <Badge
                    size="sm"
                    colorPalette="gray"
                    width="fit-content"
                    data-testid="braid-paused"
                  >
                    <Pause size={12} aria-hidden />
                    Paused
                  </Badge>
                ) : null}
                <Text fontSize="sm" color="fg.muted">
                  {braidFromText({ fromMs: row.fromMs, showsTime: row.fromShowsTime })}
                </Text>
                <Text fontSize="sm" color="fg.muted">
                  {row.expiresAtMs === null ? "No end date" : `Until ${day(row.expiresAtMs)}`}
                </Text>
              </Stack>
            </ListTable.Cell>
            <ListTable.Cell>
              <Text fontSize="sm" color="fg.muted" data-testid="braid-activity">
                {activityText({ paused, spans: activity?.get(row.braidId) })}
              </Text>
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
                    <Link href={braidAuditHref(row.braidId)}>View in audit log</Link>
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
