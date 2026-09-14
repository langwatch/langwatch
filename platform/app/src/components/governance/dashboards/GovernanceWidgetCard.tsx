import { Button, Heading, HStack, Text, VStack } from "@chakra-ui/react";
import { useMemo } from "react";

import { CHART_GRID_DRAG_HANDLE_CLASS } from "~/components/analytics/reports/ChartGrid";
import type {
  ChartFrameDashboardContext,
  ChartFrameParamsSnapshot,
} from "~/features/custom-chart-playground/bridge/bridgeProtocol";
import { CHART_FRAME_MIN_HEIGHT_PX } from "~/features/custom-chart-playground/bridge/bridgeProtocol";
import type {
  ChartFrameExecuteQuery,
  ChartFrameLogEntry,
} from "~/features/custom-chart-playground/bridge/frameBridge";
import { SandboxedChartFrame } from "~/features/custom-chart-playground/SandboxedChartFrame";
import { chartGridCardHeightPx } from "~/server/analytics/chartGrid";

import type { GovernanceWidget } from "./governanceWidgets";

/**
 * One authored widget, drawn on the governance grid.
 *
 * The card is a picture, not a workspace. It carries a title and a chart and
 * nothing that could change either — no menu, no rename, no place a dashboard
 * could be saved from — because the widgets here are authored in the
 * repository rather than by the reader, and a control that looks like it
 * persists something would be lying about what the page is.
 *
 * The chart itself runs in the sandboxed frame, over a context that names no
 * project. That absence is the safety property: with no project in the
 * context there is no id for author code to read against, so the figures on
 * this page can only ever be the invented ones the executor answers with.
 *
 * With sample data off there is nothing to draw — the cost rollup these
 * widgets ask about is not answerable from a real read yet — so the card says
 * what would fill it and offers the one move that does. It is not an error
 * state and must never look like one: a red card here sends a cost owner
 * hunting for a broken read that does not exist.
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

export interface GovernanceWidgetCardProps {
  widget: GovernanceWidget;
  /** False draws the empty card below rather than the frame. */
  showSample: boolean;
  executeQuery: ChartFrameExecuteQuery;
  timeWindow: ChartFrameDashboardContext["timeWindow"];
  onShowSample: () => void;
}

export function GovernanceWidgetCard({
  widget,
  showSample,
  executeQuery,
  timeWindow,
  onShowSample,
}: GovernanceWidgetCardProps) {
  // Built literally, with no project key present at all: an absent key cannot
  // be forwarded by mistake the way an undefined one can.
  const dashboardContext = useMemo<ChartFrameDashboardContext>(
    () => ({
      timeWindow,
      granularitySeconds: GOVERNANCE_GRANULARITY_SECONDS,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      theme: "light",
    }),
    [timeWindow],
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
      <HStack gap={2} className={CHART_GRID_DRAG_HANDLE_CLASS}>
        <Heading as="h3" size="sm">
          {widget.name}
        </Heading>
      </HStack>
      {showSample ? (
        <SandboxedChartFrame
          code={widget.definition.code}
          executeQuery={executeQuery}
          dashboardContext={dashboardContext}
          params={NO_PARAMS}
          onLog={discardFrameLog}
          maxHeight={frameMaxHeight}
        />
      ) : (
        <VStack
          align="start"
          justify="center"
          flex="1"
          gap={2}
          color="fg.muted"
        >
          <Text fontSize="sm" color="fg">
            Nothing measured yet.
          </Text>
          <Text fontSize="sm">
            Sample data draws this widget from invented figures.
          </Text>
          <Button size="sm" variant="outline" onClick={onShowSample}>
            Turn on sample data
          </Button>
        </VStack>
      )}
    </VStack>
  );
}
