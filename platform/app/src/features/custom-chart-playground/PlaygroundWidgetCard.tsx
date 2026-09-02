/**
 * One persisted playground widget: a sortable card showing only its chart —
 * a sandboxed frame, a title, and a size/edit/delete menu. All editing (the
 * React/TSX file, the declared queries) happens in `PlaygroundWidgetEditDrawer`,
 * which this card owns and opens from the menu's Edit item.
 *
 * The frame never holds SQL or the projectId — the parent does. Each
 * `LW.query(name, params)` from the frame is resolved here, through the same
 * abortable LangWatchQL executor the workbench uses (`usePlaygroundWidgetExecutor`).
 *
 * The chart previews the drawer's draft LIVE, not just the persisted widget —
 * that's the "save-less feedback" the drawer promises. The frame's `code` and
 * the executor's queries are both fed from a DEBOUNCED copy of the draft
 * rather than the draft itself: the frame is a full remount (fresh CDN
 * scripts, a fresh Babel compile) on every identity change, and doing that on
 * every keystroke would be exactly as janky as it sounds.
 */

import { Box, Card, HStack, IconButton, Text } from "@chakra-ui/react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical } from "lucide-react";
import { useEffect, useState } from "react";
import type { SizeOption } from "~/components/analytics/reports/GraphCardMenu";
import { GraphCardMenu } from "~/components/analytics/reports/GraphCardMenu";
import { useColorMode } from "~/components/ui/color-mode";
import type { PlaygroundQuery } from "~/server/analytics/playgroundWidgetDefinition";

import { PlaygroundWidgetEditDrawer } from "./PlaygroundWidgetEditDrawer";
import { SandboxedChartFrame } from "./SandboxedChartFrame";
import { usePlaygroundChartNavigate } from "./usePlaygroundChartNavigate";
import { usePlaygroundWidgetExecutor } from "./usePlaygroundWidgetExecutor";

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

/** The height a card's row span grants its frame — mirrors the report grid. */
const rowSpanHeight = (rowSpan: number): number => (rowSpan === 2 ? 600 : 300);

/** The drawer's own chart preview isn't grid-constrained — a fixed, generous height. */
const DRAWER_PREVIEW_HEIGHT_PX = 320;

/** How long the drawer's draft sits idle before the chart preview re-mounts. */
const PREVIEW_DEBOUNCE_MS = 600;

// The playground surfaces frame output in the chart itself; no log panel.
const noopLog = () => {
  // Intentionally empty.
};

/** Cheap and correct at this scale: a widget's queries are a handful of small objects. */
function queriesEqual(a: PlaygroundQuery[], b: PlaygroundQuery[]): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

interface PlaygroundWidgetCardProps {
  widget: PlaygroundWidget;
  projectId: string;
  projectSlug: string;
  onDelete: () => void;
  onSizeChange: (size: SizeOption) => void;
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

  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [draftCode, setDraftCode] = useState(widget.code);
  const [draftQueries, setDraftQueries] = useState(widget.queries);

  // Reseed the drafts whenever the persisted record changes underneath them:
  // a save from this card, or a refetch.
  useEffect(() => {
    setDraftCode(widget.code);
    setDraftQueries(widget.queries);
  }, [widget.code, widget.queries]);

  // The chart's own view of the draft, updated only after typing settles —
  // see the file header for why this can't just be draftCode/draftQueries.
  const [previewCode, setPreviewCode] = useState(widget.code);
  const [previewQueries, setPreviewQueries] = useState(widget.queries);
  useEffect(() => {
    const timer = setTimeout(() => {
      setPreviewCode(draftCode);
      setPreviewQueries(draftQueries);
    }, PREVIEW_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [draftCode, draftQueries]);

  const { executeQuery, runStandalone, params, lastRuns } =
    usePlaygroundWidgetExecutor(projectId, previewQueries);
  const onNavigate = usePlaygroundChartNavigate(projectSlug);

  const isDirty =
    draftCode !== widget.code || !queriesEqual(draftQueries, widget.queries);

  const handleSave = () => {
    onSave(
      { id: widget.id, code: draftCode, queries: draftQueries },
      { onSuccess: () => setIsDrawerOpen(false) },
    );
  };

  // Reverts the draft AND closes — covers Cancel, the drawer's own close
  // trigger, and clicking outside it, so none of the three can leave a
  // discarded edit sitting in the draft for the next open to reveal.
  const handleClose = () => {
    setDraftCode(widget.code);
    setDraftQueries(widget.queries);
    setIsDrawerOpen(false);
  };

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
            <GraphCardMenu
              graphId={widget.id}
              projectSlug={projectSlug}
              colSpan={widget.colSpan}
              rowSpan={widget.rowSpan}
              onEdit={() => setIsDrawerOpen(true)}
              onSizeChange={onSizeChange}
              onDelete={onDelete}
              isDeleting={isDeleting}
            />
          </HStack>

          {/* Not rendered while the drawer is open — the drawer mounts its
              own copy of this same frame instead, so there is never more
              than one live iframe (and one LW.query dispatch) running the
              same preview at once. */}
          {!isDrawerOpen && (
            <Box flex={1} minHeight={0}>
              <SandboxedChartFrame
                key={`${previewCode}\u0000${JSON.stringify(previewQueries)}`}
                code={previewCode}
                executeQuery={executeQuery}
                params={params}
                theme={colorMode === "dark" ? "dark" : "light"}
                onLog={noopLog}
                onNavigate={onNavigate}
                maxHeight={rowSpanHeight(widget.rowSpan)}
              />
            </Box>
          )}
        </Card.Body>
      </Card.Root>

      <PlaygroundWidgetEditDrawer
        open={isDrawerOpen}
        code={draftCode}
        queries={draftQueries}
        onCodeChange={setDraftCode}
        onQueriesChange={setDraftQueries}
        lastRuns={lastRuns}
        onRun={runStandalone}
        isDirty={isDirty}
        isSaving={isSaving}
        onClose={handleClose}
        onSave={handleSave}
        chart={
          isDrawerOpen ? (
            <SandboxedChartFrame
              key={`${previewCode}\u0000${JSON.stringify(previewQueries)}`}
              code={previewCode}
              executeQuery={executeQuery}
              params={params}
              theme={colorMode === "dark" ? "dark" : "light"}
              onLog={noopLog}
              onNavigate={onNavigate}
              maxHeight={DRAWER_PREVIEW_HEIGHT_PX}
            />
          ) : null
        }
      />
    </Box>
  );
}
