import type { AnnotationWithUser } from "@langwatch/annotation-contract";
import { MoreVerticalIcon } from "@langwatch/design-system/icons";
import { ListTable, type ListTableRowProps } from "@langwatch/design-system/list-table";
import { Menu } from "@langwatch/design-system/menu";
import { Badge, HStack, IconButton, Text, VStack } from "@langwatch/design-system/primitives";
import { Tooltip } from "@langwatch/design-system/tooltip";
import { toDate } from "@langwatch/time";
import { Database, Eye, MessageCircle, Trash2 } from "lucide-react";
import type { ReactElement, ReactNode } from "react";
import { z } from "zod";

import type { AnnotationRow, AnnotationUser, DisplayMoment } from "../../model/annotation-row.ts";
import { AnnotationAvatarGroup } from "../elements/annotation-avatar-group.tsx";
import {
  annotationColumnOptions,
  scoreColumnId,
  visibleColumnIds,
  type AnnotationColumnChoices,
} from "../elements/annotation-columns.ts";
import { AnnotationCommentsChip } from "../elements/annotation-comments-chip.tsx";
import { AnnotationSuggestionsChip } from "../elements/annotation-suggestions-chip.tsx";

type ActiveScoreType = { id: string; name: string };

export type AnnotationTableTraceField = {
  field: "input" | "output";
  value: string;
};

export type AnnotationTableProps = {
  rows: AnnotationRow[];
  activeScoreTypes: readonly ActiveScoreType[];
  dateColumnLabel: string;
  /** What the reviewer chose to show or hide; a column not chosen keeps its default. */
  columnChoices?: AnnotationColumnChoices;
  selectedRowIds: ReadonlySet<string>;
  allRowsSelected: boolean;
  someRowsSelected: boolean;
  onToggleAll: (selected: boolean) => void;
  onToggleRow: (rowId: string) => void;
  onRowClick: (row: AnnotationRow) => void;
  onViewTrace: (row: AnnotationRow) => void;
  onAddToDataset: (traceId: string) => void;
  onRemoveFromQueue: (queueItemId: string) => void;
  renderAvatar: (user: AnnotationUser) => ReactNode;
  renderTraceField: (field: AnnotationTableTraceField) => ReactNode;
  /**
   * Wraps one rendered row. `children` is the single `ListTable.Row` element, not
   * arbitrary nodes; the wrapper may add the row's own props to it.
   */
  renderRowContext?: (row: AnnotationRow, children: ReactElement<ListTableRowProps>) => ReactNode;
};

/** The header select-all checkbox's tri-state, from the row selection counts. */
function headerCheckedState({
  allRowsSelected,
  someRowsSelected,
}: {
  allRowsSelected: boolean;
  someRowsSelected: boolean;
}): boolean | "indeterminate" {
  if (allRowsSelected) return true;

  if (someRowsSelected) return "indeterminate";

  return false;
}

export function AnnotationTable({
  rows,
  activeScoreTypes,
  dateColumnLabel,
  columnChoices = {},
  selectedRowIds,
  allRowsSelected,
  someRowsSelected,
  onToggleAll,
  onToggleRow,
  onRowClick,
  onViewTrace,
  onAddToDataset,
  onRemoveFromQueue,
  renderAvatar,
  renderTraceField,
  renderRowContext,
}: AnnotationTableProps) {
  const shown = new Set(
    visibleColumnIds({
      columns: annotationColumnOptions({ dateColumnLabel, scoreTypes: [...activeScoreTypes] }),
      choices: columnChoices,
    }),
  );

  return (
    <>
      <ListTable.Header>
        <ListTable.Row>
          {rows.length > 0 ? (
            <ListTable.SelectHeader
              label="Select all on this page"
              checked={headerCheckedState({ allRowsSelected, someRowsSelected })}
              onCheckedChange={() => onToggleAll(!allRowsSelected)}
            />
          ) : (
            <ListTable.ColumnHeader width="fit" label="Select" />
          )}
          {shown.has("queuedBy") && <ListTable.ColumnHeader label="People" />}
          {shown.has("date") && <ListTable.ColumnHeader>{dateColumnLabel}</ListTable.ColumnHeader>}
          {shown.has("input") && <ListTable.ColumnHeader>Input</ListTable.ColumnHeader>}
          {shown.has("output") && <ListTable.ColumnHeader>Output</ListTable.ColumnHeader>}
          {shown.has("scores") && <ListTable.ColumnHeader>Scores</ListTable.ColumnHeader>}
          {shown.has("comments") && <ListTable.ColumnHeader>Comments</ListTable.ColumnHeader>}
          {shown.has("suggestions") && <ListTable.ColumnHeader>Suggestions</ListTable.ColumnHeader>}
          {activeScoreTypes
            .filter((scoreType) => shown.has(scoreColumnId(scoreType.id)))
            .map((scoreType) => (
              <ListTable.ColumnHeader key={scoreType.id}>{scoreType.name}</ListTable.ColumnHeader>
            ))}
          <ListTable.ActionHeader />
        </ListTable.Row>
      </ListTable.Header>
      <ListTable.Body>
        {rows.map((row) => {
          const rowElement = (
            <ListTable.Row
              key={row.id}
              onActivate={() => onRowClick(row)}
              data-testid="annotation-row"
            >
              <ListTable.SelectCell
                label={`Select trace ${row.traceId}`}
                checked={selectedRowIds.has(row.id)}
                onCheckedChange={() => onToggleRow(row.id)}
              />
              {shown.has("queuedBy") && (
                <ListTable.Cell valign="top">
                  <Tooltip content={<PeopleTooltip row={row} />}>
                    <HStack>
                      <AnnotationAvatarGroup
                        createdByUser={row.createdByUser}
                        annotations={row.annotations}
                        renderAvatar={renderAvatar}
                      />
                    </HStack>
                  </Tooltip>
                </ListTable.Cell>
              )}
              {shown.has("date") && (
                <ListTable.Cell valign="top">
                  <Text whiteSpace="nowrap">{formatRowDate(row.date)}</Text>
                </ListTable.Cell>
              )}
              {shown.has("input") && (
                <ListTable.Cell valign="top">
                  {renderTraceField({
                    field: "input",
                    value: row.trace?.input?.value ?? "<empty>",
                  })}
                </ListTable.Cell>
              )}
              {shown.has("output") && (
                <ListTable.Cell valign="top">
                  {renderTraceField({
                    field: "output",
                    value: row.trace?.output?.value ?? "<empty>",
                  })}
                </ListTable.Cell>
              )}
              {shown.has("scores") && (
                <ListTable.Cell valign="top">
                  <GivenScoresCell
                    annotations={row.annotations}
                    activeScoreTypes={activeScoreTypes}
                  />
                </ListTable.Cell>
              )}
              {shown.has("comments") && (
                <ListTable.Cell valign="top">
                  <AnnotationCommentsChip annotations={row.annotations} traceId={row.traceId} />
                </ListTable.Cell>
              )}
              {shown.has("suggestions") && (
                <ListTable.Cell valign="top">
                  <AnnotationSuggestionsChip annotations={row.annotations} traceId={row.traceId} />
                </ListTable.Cell>
              )}
              {activeScoreTypes
                .filter((scoreType) => shown.has(scoreColumnId(scoreType.id)))
                .map((scoreType) => (
                  <ListTable.Cell key={scoreType.id} valign="top">
                    <ScoreCell annotations={row.annotations} scoreTypeId={scoreType.id} />
                  </ListTable.Cell>
                ))}
              <ListTable.ActionCell>
                <RowActions
                  row={row}
                  onViewTrace={onViewTrace}
                  onAddToDataset={onAddToDataset}
                  onRemoveFromQueue={onRemoveFromQueue}
                />
              </ListTable.ActionCell>
            </ListTable.Row>
          );

          return renderRowContext ? renderRowContext(row, rowElement) : rowElement;
        })}
      </ListTable.Body>
    </>
  );
}

function PeopleTooltip({ row }: { row: AnnotationRow }) {
  const names = annotatorNames(row.annotations);

  return (
    <VStack align="start" gap={0}>
      {row.createdByUser && <Text marginBottom={2}>Queued by {row.createdByUser.name}</Text>}
      {names.length > 0 && (
        <>
          <Text>Annotated by:</Text>
          {names.map((name) => (
            <Text key={name}>{name}</Text>
          ))}
        </>
      )}
    </VStack>
  );
}

function ScoreCell({
  annotations,
  scoreTypeId,
}: {
  annotations: AnnotationWithUser[];
  scoreTypeId: string;
}) {
  return (
    <VStack align="start" gap={2}>
      {scoreValuesFor(annotations, scoreTypeId).map((score) => (
        <HStack key={score.annotationId} gap={1} wrap="wrap">
          {score.value.map((value) => (
            <Badge key={value}>{value}</Badge>
          ))}
          {score.reason && (
            <Tooltip content={score.reason}>
              <MessageCircle size={14} />
            </Tooltip>
          )}
        </HStack>
      ))}
    </VStack>
  );
}

/** Every score given on the row, named by its type: the folded "Scores" column. */
function GivenScoresCell({
  annotations,
  activeScoreTypes,
}: {
  annotations: AnnotationWithUser[];
  activeScoreTypes: readonly ActiveScoreType[];
}) {
  return (
    <HStack gap={1} wrap="wrap" minWidth="140px">
      {activeScoreTypes.flatMap((scoreType) =>
        scoreValuesFor(annotations, scoreType.id).map((score) => (
          <Badge key={`${score.annotationId}-${scoreType.id}`} whiteSpace="normal">
            {scoreType.name}: {score.value.join(", ")}
            {score.reason && (
              <Tooltip content={score.reason}>
                <MessageCircle size={14} />
              </Tooltip>
            )}
          </Badge>
        )),
      )}
    </HStack>
  );
}

function RowActions({
  row,
  onViewTrace,
  onAddToDataset,
  onRemoveFromQueue,
}: {
  row: AnnotationRow;
  onViewTrace: (row: AnnotationRow) => void;
  onAddToDataset: (traceId: string) => void;
  onRemoveFromQueue: (queueItemId: string) => void;
}) {
  const queueItemId = row.queueItemId;

  return (
    <Menu.Root>
      <Menu.Trigger asChild>
        <IconButton
          aria-label={`Actions for trace ${row.traceId}`}
          variant="ghost"
          size="sm"
          onClick={(event) => event.stopPropagation()}
        >
          <MoreVerticalIcon size={16} />
        </IconButton>
      </Menu.Trigger>
      <Menu.Content>
        <Menu.Item
          value="view-trace"
          onClick={(event) => {
            event.stopPropagation();
            onViewTrace(row);
          }}
        >
          <Eye size={14} /> View trace
        </Menu.Item>
        <Menu.Item
          value="add-to-dataset"
          onClick={(event) => {
            event.stopPropagation();
            onAddToDataset(row.traceId);
          }}
        >
          <Database size={14} /> Add to dataset
        </Menu.Item>
        {queueItemId && (
          <Menu.Item
            value="remove-from-queue"
            color="red.fg"
            onClick={(event) => {
              event.stopPropagation();
              onRemoveFromQueue(queueItemId);
            }}
          >
            <Trash2 size={14} /> Remove from queue
          </Menu.Item>
        )}
      </Menu.Content>
    </Menu.Root>
  );
}

function formatRowDate(date: DisplayMoment | null): string {
  return date ? toDate(date).toLocaleDateString() : "-";
}

const scoreOptionsSchema = z.record(z.string(), z.unknown());
const scoreValueSchema = z.object({
  value: z
    .union([z.string(), z.array(z.string())])
    .nullable()
    .optional(),
  reason: z.string().nullable().optional(),
});

function scoreValuesFor(
  annotations: AnnotationWithUser[],
  scoreTypeId: string,
): { annotationId: string; value: string[]; reason?: string | null }[] {
  return annotations.flatMap((annotation) => {
    const options = scoreOptionsSchema.safeParse(annotation.scoreOptions);

    if (!options.success) {
      return [];
    }

    const score = scoreValueSchema.safeParse(options.data[scoreTypeId]);
    if (!score.success || !score.data.value) return [];

    const value = Array.isArray(score.data.value) ? score.data.value : [score.data.value];
    if (value.length === 0) return [];

    return [{ annotationId: annotation.id, value, reason: score.data.reason ?? null }];
  });
}

function annotatorNames(annotations: AnnotationWithUser[]): string[] {
  return Array.from(
    new Set(
      annotations
        .map((annotation) => annotation.user?.name)
        .filter((name): name is string => !!name),
    ),
  );
}
