import type { AnnotationWithUser } from "@langwatch/annotation-contract";
import { Checkbox } from "@langwatch/design-system/checkbox";
import { Menu } from "@langwatch/design-system/menu";
import {
  Badge,
  Box,
  HStack,
  IconButton,
  Skeleton,
  Table,
  Text,
  VStack,
} from "@langwatch/design-system/primitives";
import { Tooltip } from "@langwatch/design-system/tooltip";
import { toDate } from "@langwatch/time";
import { Database, Eye, MessageCircle, MoreVertical, Trash2 } from "lucide-react";
import type { CSSProperties, ReactElement, ReactNode } from "react";
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
   * Wraps one rendered row. `children` is the single `<Table.Row>` element, not
   * arbitrary nodes: the app's wrapper `cloneElement`s it to add `className` and
   * `style`, so the element type has to say those props are accepted.
   */
  renderRowContext?: (
    row: AnnotationRow,
    children: ReactElement<{ className?: string; style?: CSSProperties }>,
  ) => ReactNode;
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
      <Table.Header>
        <Table.Row>
          <Table.ColumnHeader width="1px" paddingX={0}>
            {rows.length > 0 && (
              <SelectCheckbox
                ariaLabel="Select all on this page"
                checked={headerCheckedState({ allRowsSelected, someRowsSelected })}
                onToggle={() => onToggleAll(!allRowsSelected)}
              />
            )}
          </Table.ColumnHeader>
          {shown.has("queuedBy") && <Table.ColumnHeader />}
          {shown.has("date") && <Table.ColumnHeader>{dateColumnLabel}</Table.ColumnHeader>}
          {shown.has("input") && <Table.ColumnHeader>Input</Table.ColumnHeader>}
          {shown.has("output") && <Table.ColumnHeader>Output</Table.ColumnHeader>}
          {shown.has("scores") && <Table.ColumnHeader>Scores</Table.ColumnHeader>}
          {shown.has("comments") && <Table.ColumnHeader>Comments</Table.ColumnHeader>}
          {shown.has("suggestions") && <Table.ColumnHeader>Suggestions</Table.ColumnHeader>}
          {activeScoreTypes
            .filter((scoreType) => shown.has(scoreColumnId(scoreType.id)))
            .map((scoreType) => (
              <Table.ColumnHeader key={scoreType.id}>{scoreType.name}</Table.ColumnHeader>
            ))}
          <Table.ColumnHeader width="48px" />
        </Table.Row>
      </Table.Header>
      <Table.Body>
        {rows.map((row) => {
          const rowElement = (
            <Table.Row
              key={row.id}
              cursor="pointer"
              _hover={{ bg: "bg.emphasized" }}
              backgroundColor={row.doneAt ? "bg.subtle" : "bg.panel"}
              onClick={() => onRowClick(row)}
              data-testid="annotation-row"
            >
              <Table.Cell paddingX={0} verticalAlign="top">
                <SelectCheckbox
                  ariaLabel={`Select trace ${row.traceId}`}
                  checked={selectedRowIds.has(row.id)}
                  onToggle={() => onToggleRow(row.id)}
                />
              </Table.Cell>
              {shown.has("queuedBy") && (
                <Table.Cell verticalAlign="top">
                  <Tooltip content={<PeopleTooltip row={row} />}>
                    <HStack>
                      <AnnotationAvatarGroup
                        createdByUser={row.createdByUser}
                        annotations={row.annotations}
                        renderAvatar={renderAvatar}
                      />
                    </HStack>
                  </Tooltip>
                </Table.Cell>
              )}
              {shown.has("date") && (
                <Table.Cell verticalAlign="top">
                  <Text whiteSpace="nowrap">{formatRowDate(row.date)}</Text>
                </Table.Cell>
              )}
              {shown.has("input") && (
                <Table.Cell verticalAlign="top">
                  {renderTraceField({
                    field: "input",
                    value: row.trace?.input?.value ?? "<empty>",
                  })}
                </Table.Cell>
              )}
              {shown.has("output") && (
                <Table.Cell verticalAlign="top">
                  {renderTraceField({
                    field: "output",
                    value: row.trace?.output?.value ?? "<empty>",
                  })}
                </Table.Cell>
              )}
              {shown.has("scores") && (
                <Table.Cell verticalAlign="top">
                  <GivenScoresCell
                    annotations={row.annotations}
                    activeScoreTypes={activeScoreTypes}
                  />
                </Table.Cell>
              )}
              {shown.has("comments") && (
                <Table.Cell verticalAlign="top">
                  <AnnotationCommentsChip annotations={row.annotations} traceId={row.traceId} />
                </Table.Cell>
              )}
              {shown.has("suggestions") && (
                <Table.Cell verticalAlign="top">
                  <AnnotationSuggestionsChip annotations={row.annotations} traceId={row.traceId} />
                </Table.Cell>
              )}
              {activeScoreTypes
                .filter((scoreType) => shown.has(scoreColumnId(scoreType.id)))
                .map((scoreType) => (
                  <Table.Cell key={scoreType.id} verticalAlign="top">
                    <ScoreCell annotations={row.annotations} scoreTypeId={scoreType.id} />
                  </Table.Cell>
                ))}
              <Table.Cell verticalAlign="top">
                <RowActions
                  row={row}
                  onViewTrace={onViewTrace}
                  onAddToDataset={onAddToDataset}
                  onRemoveFromQueue={onRemoveFromQueue}
                />
              </Table.Cell>
            </Table.Row>
          );

          return renderRowContext ? renderRowContext(row, rowElement) : rowElement;
        })}
      </Table.Body>
    </>
  );
}

function SelectCheckbox({
  ariaLabel,
  checked,
  onToggle,
}: {
  ariaLabel: string;
  checked: boolean | "indeterminate";
  onToggle: () => void;
}) {
  // The cell's click stays here: ticking a row selects it, never opens it.
  return (
    <Box onClick={(event) => event.stopPropagation()}>
      <Checkbox
        size="sm"
        checked={checked}
        onCheckedChange={onToggle}
        inputProps={{ "aria-label": ariaLabel }}
        display="flex"
        alignItems="center"
        justifyContent="center"
        minHeight="32px"
        paddingX={2}
        cursor="pointer"
      />
    </Box>
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
          <MoreVertical size={16} />
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
            color="red.500"
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

export function AnnotationTableSkeleton() {
  return (
    <Box flex={1} minWidth={0} overflow="auto" paddingX={6}>
      <Table.Root variant="line" width="full">
        <Table.Header>
          <Table.Row>
            {Array.from({ length: 6 }).map((_, index) => (
              <Table.ColumnHeader key={index}>
                <Skeleton height="20px" width="100px" />
              </Table.ColumnHeader>
            ))}
          </Table.Row>
        </Table.Header>
        <Table.Body>
          {Array.from({ length: 5 }).map((_, rowIndex) => (
            <Table.Row key={rowIndex}>
              {Array.from({ length: 6 }).map((_, columnIndex) => (
                <Table.Cell key={columnIndex}>
                  <Skeleton
                    height="20px"
                    width={columnIndex === 2 || columnIndex === 3 ? "200px" : "100px"}
                  />
                </Table.Cell>
              ))}
            </Table.Row>
          ))}
        </Table.Body>
      </Table.Root>
    </Box>
  );
}
