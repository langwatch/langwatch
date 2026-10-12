import { Button, Heading, HStack, Text, VStack } from "@chakra-ui/react";
import { Code } from "lucide-react";
import { useMemo } from "react";

import { CHART_GRID_DRAG_HANDLE_CLASS } from "~/components/analytics/reports/ChartGrid";
import { useColorMode } from "~/components/ui/color-mode";
import type {
  ChartFrameDashboardContext,
  ChartFrameParamsSnapshot,
} from "~/features/custom-chart-playground/bridge/bridgeProtocol";
import { CHART_FRAME_MIN_HEIGHT_PX } from "~/features/custom-chart-playground/bridge/bridgeProtocol";
import type {
  ChartFrameExecuteQuery,
  ChartFrameLogEntry,
} from "~/features/custom-chart-playground/bridge/frameBridge";
import { DashboardWidgetEditDrawer } from "~/features/custom-chart-playground/DashboardWidgetEditDrawer";
import { SandboxedChartFrame } from "~/features/custom-chart-playground/SandboxedChartFrame";
import { chartGridCardHeightPx } from "~/server/analytics/chartGrid";

import type { GovernanceWidget } from "./governanceWidgets";
import { useGovernanceWidgetEditor } from "./useGovernanceWidgetEditor";

/**
 * One authored widget, drawn on the governance grid.
 *
 * The card is a picture. It carries a title, a chart, and one way through to
 * the question behind that chart — and nothing else. No menu, no rename, no
 * duplicate, no place a dashboard could be saved from: the widgets here are
 * authored in the repository rather than by the reader, and a second, half-
 * built set of those controls would be lying about what the page is.
 *
 * The one way through is Query, and it opens the PRODUCT'S own widget editor —
 * the same drawer a customer edits their own widgets in, whole. It belongs on
 * the card rather than in one list of four, so the chart and the statement
 * behind it are read side by side. What the editor can and cannot do on this
 * page, and why it is offered whole rather than trimmed, is in
 * `useGovernanceWidgetEditor.ts`.
 *
 * The chart itself runs in the sandboxed frame, over a context that names no
 * project. That absence is the safety property: with no project in the
 * context there is no id for author code to read against, so the figures on
 * this page can only ever be the invented ones the executor answers with. The
 * preview inside the editor runs over the same context, for the same reason.
 *
 * With sample data off there is nothing to draw — the cost rollup these
 * widgets ask about is not answerable from a real read yet — so the card says
 * what would fill it and leaves it there. It is not an error state and must
 * never look like one: a red card here sends a cost owner hunting for a broken
 * read that does not exist.
 *
 * It does not carry the sample switch either. That switch is section-wide and
 * singular, and the page header already holds it; a copy on every empty card
 * repeats one choice four times over and reads as four separate decisions.
 */

/**
 * Chrome above and below the frame inside the card: the panel's own padding
 * (two of 4) plus the header row and the gap under it. Subtracted from the
 * card's grid height so a frame sized to its card does not overflow it.
 */
const CARD_CHROME_PX = 68;

/**
 * The authored widgets declare no query parameters, so there is nothing for
 * the frame to snapshot. One frozen empty object rather than a fresh literal
 * per render, since the frame is handed this once on init.
 */
const NO_PARAMS: ChartFrameParamsSnapshot = Object.freeze({});

/** Nothing on this page shows a frame's logs, so they have nowhere to go. */
const discardFrameLog = (_entry: ChartFrameLogEntry) => undefined;

/** A month of seconds: these widgets are read at a per-day-or-coarser grain. */
const GOVERNANCE_GRANULARITY_SECONDS = 2_592_000;

/**
 * How tall the preview chart stands inside the editor. Fixed rather than taken
 * from the grid: the drawer is one width whatever cell the widget sits in, and
 * the tabs under the preview need the rest of the height more than it does.
 */
const EDITOR_PREVIEW_HEIGHT_PX = 240;

export interface GovernanceWidgetCardProps {
  widget: GovernanceWidget;
  /** False draws the empty card below rather than the frame. */
  showSample: boolean;
  executeQuery: ChartFrameExecuteQuery;
  timeWindow: ChartFrameDashboardContext["timeWindow"];
  /**
   * Hands the edited widget back to the page, which keeps it for the visit and
   * writes nothing. See `useGovernanceWidgetEditor.ts`.
   */
  onSave: (widget: GovernanceWidget) => void;
}

export function GovernanceWidgetCard({
  widget,
  showSample,
  executeQuery,
  timeWindow,
  onSave,
}: GovernanceWidgetCardProps) {
  const { colorMode } = useColorMode();
  const editor = useGovernanceWidgetEditor({ widget, executeQuery, onSave });

  // Built literally, with no project key present at all: an absent key cannot
  // be forwarded by mistake the way an undefined one can.
  //
  // The theme is the reader's own, read the same way `DashboardWidgetFrame`
  // reads it: author code inside the frame has no other way to know which mode
  // the page is in, and a chart fixed to light paints white panels down a dark
  // page. Anything other than dark falls to light, because `colorMode` is
  // undefined until the theme has resolved.
  const dashboardContext = useMemo<ChartFrameDashboardContext>(
    () => ({
      timeWindow,
      granularitySeconds: GOVERNANCE_GRANULARITY_SECONDS,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      theme: colorMode === "dark" ? "dark" : "light",
    }),
    [timeWindow, colorMode],
  );

  const frameMaxHeight = Math.max(
    CHART_FRAME_MIN_HEIGHT_PX,
    chartGridCardHeightPx(widget.placement.rowSpan) - CARD_CHROME_PX,
  );

  return (
    <VStack
      data-testid="governance-widget-card"
      align="stretch"
      height="full"
      gap={3}
      borderWidth="1px"
      borderColor="border.subtle"
      borderRadius="lg"
      backgroundColor="bg.panel"
      padding={4}
    >
      <CardHeader name={widget.name} onOpenEditor={editor.open} />
      {showSample ? (
        <SandboxedChartFrame
          code={editor.previewCode}
          executeQuery={executeQuery}
          dashboardContext={dashboardContext}
          params={NO_PARAMS}
          onLog={discardFrameLog}
          maxHeight={frameMaxHeight}
        />
      ) : (
        <NothingMeasuredYet />
      )}
      <WidgetQueryEditor
        editor={editor}
        showSample={showSample}
        executeQuery={executeQuery}
        dashboardContext={dashboardContext}
      />
    </VStack>
  );
}

/** The widget's title, and the one way through to the question behind it. */
function CardHeader({
  name,
  onOpenEditor,
}: {
  name: string;
  onOpenEditor: () => void;
}) {
  return (
    <HStack gap={2}>
      {/* Only the title is the handle — a button inside one is dragged as often
          as it is pressed — and it carries the same grab cursor the product's
          own cards carry on the same grid, since a handle that looks like plain
          text is a handle nobody finds.

          It grows alone: a `Spacer` beside it would split the row between the
          two of them and leave the title half the width it can have. */}
      <HStack
        gap={2}
        flex="1"
        minWidth={0}
        className={CHART_GRID_DRAG_HANDLE_CLASS}
        cursor="grab"
        _active={{ cursor: "grabbing" }}
      >
        {/* Truncated rather than wrapped: the card subtracts a FIXED header
            height from its grid cell to size the chart frame, so a title that
            took a second line would push the frame past the bottom of its own
            card. */}
        <Heading as="h3" size="sm" truncate>
          {name}
        </Heading>
      </HStack>
      <Button
        size="xs"
        variant="ghost"
        color="fg.muted"
        flexShrink={0}
        onClick={onOpenEditor}
      >
        <Code size={14} /> Query
      </Button>
    </HStack>
  );
}

/**
 * What stands where the chart would be with sample data off. Nothing failed,
 * so nothing here may look like it did.
 */
function NothingMeasuredYet() {
  return (
    <VStack align="start" justify="center" flex="1" gap={2} color="fg.muted">
      <Text fontSize="sm" color="fg">
        Nothing measured yet.
      </Text>
      <Text fontSize="sm">
        Sample data draws this widget from invented figures.
      </Text>
    </VStack>
  );
}

/**
 * The product's own widget editor, handed this widget's draft.
 *
 * The preview inside it is a second frame over the SAME context the card's own
 * frame runs on — no project in it, so the preview can no more reach a row than
 * the card can.
 *
 * It also follows the SAME sample choice the card follows. Sample off is a
 * request not to be shown invented figures, and the banner that admits they are
 * invented is only on screen with sample on — so a chart drawn in here while it
 * is off would be invented money with nothing anywhere saying so. The statement
 * stays readable either way: it is the question, not a figure.
 */
function WidgetQueryEditor({
  editor,
  showSample,
  executeQuery,
  dashboardContext,
}: {
  editor: ReturnType<typeof useGovernanceWidgetEditor>;
  showSample: boolean;
  executeQuery: ChartFrameExecuteQuery;
  dashboardContext: ChartFrameDashboardContext;
}) {
  return (
    <DashboardWidgetEditDrawer
      open={editor.isOpen}
      chart={
        editor.isOpen ? (
          showSample ? (
            <SandboxedChartFrame
              code={editor.previewCode}
              executeQuery={executeQuery}
              dashboardContext={dashboardContext}
              params={NO_PARAMS}
              onLog={discardFrameLog}
              maxHeight={EDITOR_PREVIEW_HEIGHT_PX}
            />
          ) : (
            <NothingMeasuredYet />
          )
        ) : null
      }
      name={editor.draft.draftName}
      onNameChange={editor.draft.setDraftName}
      code={editor.draft.draftCode}
      queries={editor.draft.draftQueries}
      onCodeChange={editor.draft.setDraftCode}
      onQueriesChange={editor.draft.setDraftQueries}
      lastRuns={editor.lastRuns}
      onRun={editor.run}
      isDirty={editor.draft.isDirty}
      // Nothing is written, so there is never a write to be waiting on.
      isSaving={false}
      onClose={editor.handleClose}
      onSave={editor.handleSave}
      activeTab={editor.tab}
      onTabChange={editor.setTab}
    />
  );
}
