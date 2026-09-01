/**
 * One persisted playground widget: a sortable card wrapping a sandboxed chart
 * frame, its Chart | Code toggle, its size/edit/delete menu, and the per-widget
 * executor that runs the widget's declared queries on the frame's behalf.
 *
 * The frame never holds SQL or the projectId — the parent does. Each
 * `lw:query` from the frame is served here, against this widget's own
 * `queries`, through the same abortable LangWatchQL executor the workbench
 * uses. Re-keying the frame on the widget's `code`+`queries` is what makes a
 * Save re-run the chart: an identity change forces a fresh frame that reads
 * the new values.
 *
 * Until a widget can name which of its `queries` a given `LW.query` call
 * means (the bridge message is still `LW.query(overrides)`, no name), the
 * executor runs `queries[0]` — the query the Code panel and the drawer both
 * edit today.
 */

import { Box, Button, Card, HStack, IconButton, Text } from "@chakra-ui/react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { SizeOption } from "~/components/analytics/reports/GraphCardMenu";
import { GraphCardMenu } from "~/components/analytics/reports/GraphCardMenu";
import { useColorMode } from "~/components/ui/color-mode";
import { SegmentedControl } from "~/components/ui/segmented-control";
import { createLangWatchQLExecute } from "~/features/analytics-query/logic/lwqlExecute";
import { explainAnyError, readHandledError } from "~/features/errors";
import type { LangWatchQLGranularityStep } from "~/server/analytics/lwql/timeWindow";
import type { PlaygroundQuery } from "~/server/analytics/playgroundWidgetDefinition";
import { api } from "~/utils/api";

import type { ChartFrameParams } from "./bridge/bridgeProtocol";
import { toChartQueryResult } from "./bridge/bridgeProtocol";
import type { ChartFrameExecuteQuery } from "./bridge/frameBridge";
import { PlaygroundCodeEditor } from "./PlaygroundCodeEditor";
import { SandboxedChartFrame } from "./SandboxedChartFrame";

/** A playground widget as the grid renders it. */
export interface PlaygroundWidget {
  id: string;
  name: string;
  code: string;
  queries: PlaygroundQuery[];
  gridColumn: number;
  gridRow: number;
  colSpan: number;
  rowSpan: number;
}

/** Which half of the card is showing. */
type WidgetView = "chart" | "code";

const VIEW_ITEMS = [
  { value: "chart", label: "Chart" },
  { value: "code", label: "Code" },
];

/** Widgets run against the last 24 hours at an hourly step — no toolbar. */
const DEFAULT_GRANULARITY: LangWatchQLGranularityStep = 3600;

/** The height a card's row span grants its frame — mirrors the report grid. */
const rowSpanHeight = (rowSpan: number): number => (rowSpan === 2 ? 600 : 300);

// The playground surfaces frame output in the chart itself; no log panel.
const noopLog = () => {
  /* discard frame logs */
};

function useWidgetExecutor(projectId: string, sql: string) {
  const utils = api.useUtils();

  const sqlRef = useRef(sql);
  sqlRef.current = sql;
  const [pageWindow] = useState<{ start: number; end: number }>(() => {
    const end = Date.now();
    return { start: end - 24 * 60 * 60 * 1000, end };
  });

  const execute = useMemo(
    () => createLangWatchQLExecute({ utils, projectId }),
    [utils, projectId],
  );

  const executeQuery: ChartFrameExecuteQuery = useCallback(
    async (overrides, signal) => {
      try {
        const result = await execute(
          {
            sql: sqlRef.current,
            parameters: {},
            timeWindow: overrides.timeWindow ?? pageWindow,
            granularitySeconds:
              overrides.granularitySeconds ?? DEFAULT_GRANULARITY,
          },
          { signal },
        );
        return toChartQueryResult(result);
      } catch (error) {
        // ADR-045: registry copy only, with the lwql_* code riding along.
        const explained = explainAnyError(error);
        throw {
          code: readHandledError(error)?.code ?? "unknown",
          title: explained.title,
          message: explained.description,
        };
      }
    },
    [execute, pageWindow],
  );

  const params: ChartFrameParams = useMemo(
    () => ({
      timeWindow: { start: pageWindow.start, end: pageWindow.end },
      granularitySeconds: DEFAULT_GRANULARITY,
    }),
    [pageWindow],
  );

  return { executeQuery, params };
}

interface WidgetCodePanelProps {
  value: string;
  onChange: (value: string) => void;
  isDirty: boolean;
  isSaving: boolean;
  onCancel: () => void;
  onSave: () => void;
}

/**
 * The card's Code side: the widget's React/TSX file, editable in place, with
 * the same Save the drawer uses. Queries stay in the drawer — a card is too
 * narrow to edit two documents, and the file is what a chart is iterated on.
 */
function WidgetCodePanel({
  value,
  onChange,
  isDirty,
  isSaving,
  onCancel,
  onSave,
}: WidgetCodePanelProps) {
  return (
    <>
      <Box
        flex={1}
        minHeight="160px"
        borderWidth="1px"
        borderColor="border"
        borderRadius="md"
        overflow="hidden"
      >
        <PlaygroundCodeEditor
          language="typescript"
          value={value}
          onChange={onChange}
        />
      </Box>
      <HStack justify="space-between" minWidth={0} gap={2}>
        <Text fontSize="11px" color="fg.muted" truncate>
          widget.tsx
        </Text>
        <HStack gap={2}>
          <Button
            size="xs"
            variant="ghost"
            disabled={!isDirty || isSaving}
            onClick={onCancel}
          >
            Cancel
          </Button>
          <Button
            size="xs"
            colorPalette="orange"
            loading={isSaving}
            disabled={!isDirty}
            onClick={onSave}
          >
            Save
          </Button>
        </HStack>
      </HStack>
    </>
  );
}

interface PlaygroundWidgetCardProps {
  widget: PlaygroundWidget;
  projectId: string;
  projectSlug: string;
  onDelete: () => void;
  onSizeChange: (size: SizeOption) => void;
  onEdit: () => void;
  onSave: (
    input: { id: string; code: string; queries: PlaygroundQuery[] },
    options?: { onSuccess?: () => void },
  ) => void;
  isDeleting: boolean;
  isSaving: boolean;
}

export function PlaygroundWidgetCard({
  widget,
  projectId,
  projectSlug,
  onDelete,
  onSizeChange,
  onEdit,
  onSave,
  isDeleting,
  isSaving,
}: PlaygroundWidgetCardProps) {
  const { colorMode } = useColorMode();
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: widget.id });
  // queries[0]: the executor doesn't yet resolve `LW.query` calls by name.
  const primarySql = widget.queries[0]?.sql ?? "";
  const { executeQuery, params } = useWidgetExecutor(projectId, primarySql);

  const [view, setView] = useState<WidgetView>("chart");
  const [draftCode, setDraftCode] = useState(widget.code);

  // Reseed the draft whenever the persisted code changes underneath it: a
  // save from this card, a save from the drawer, or a refetch.
  useEffect(() => {
    setDraftCode(widget.code);
  }, [widget.code]);

  const isDirty = draftCode !== widget.code;

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    gridColumn: `span ${widget.colSpan}`,
    gridRow: `span ${widget.rowSpan}`,
  };

  return (
    <Box ref={setNodeRef} style={style} minWidth={0}>
      <Card.Root height="full" minWidth={0}>
        <Card.Body
          height="full"
          display="flex"
          flexDirection="column"
          minWidth={0}
          overflow="hidden"
          gap={2}
        >
          <HStack minWidth={0}>
            <IconButton
              aria-label="Drag widget"
              variant="ghost"
              size="xs"
              cursor="grab"
              {...attributes}
              {...listeners}
            >
              <GripVertical />
            </IconButton>
            <Text
              fontSize="sm"
              fontWeight="bold"
              flex={1}
              minWidth={0}
              truncate
            >
              {widget.name}
            </Text>
            <SegmentedControl
              size="xs"
              items={VIEW_ITEMS}
              value={view}
              onValueChange={(e) => setView(e.value as WidgetView)}
            />
            <GraphCardMenu
              graphId={widget.id}
              projectSlug={projectSlug}
              colSpan={widget.colSpan}
              rowSpan={widget.rowSpan}
              onEdit={onEdit}
              onSizeChange={onSizeChange}
              onDelete={onDelete}
              isDeleting={isDeleting}
            />
          </HStack>

          {view === "chart" ? (
            // Mounted only while it is showing. Hiding a live frame instead
            // would leave a hidden cross-origin iframe, whose timers the
            // browser throttles: that starves the shim's 500ms heartbeat and
            // trips the bridge's 1.5s watchdog, so switching back to Chart
            // would find a torn-down frame. A clean re-mount re-runs the
            // query, which is what the toggle should look like anyway.
            <Box flex={1} minHeight={0}>
              <SandboxedChartFrame
                key={`${widget.code}\u0000${primarySql}`}
                code={widget.code}
                executeQuery={executeQuery}
                params={params}
                theme={colorMode === "dark" ? "dark" : "light"}
                onLog={noopLog}
                maxHeight={rowSpanHeight(widget.rowSpan)}
              />
            </Box>
          ) : (
            <WidgetCodePanel
              value={draftCode}
              onChange={setDraftCode}
              isDirty={isDirty}
              isSaving={isSaving}
              onCancel={() => setDraftCode(widget.code)}
              onSave={() =>
                onSave(
                  { id: widget.id, code: draftCode, queries: widget.queries },
                  { onSuccess: () => setView("chart") },
                )
              }
            />
          )}
        </Card.Body>
      </Card.Root>
    </Box>
  );
}
