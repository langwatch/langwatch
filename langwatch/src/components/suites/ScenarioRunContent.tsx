/**
 * Renders scenario runs as either a grid of cards or a list of rows.
 *
 * Shared between RunRow (ungrouped view) and BatchSection (grouped view)
 * to avoid duplicating the grid/list rendering logic.
 *
 * When item count exceeds VIRTUALIZE_THRESHOLD, uses @tanstack/react-virtual
 * to only render visible items, avoiding expensive ScenarioGridCard mounts.
 */

import { Grid, VStack } from "@chakra-ui/react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { memo, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { ScenarioGridCard } from "./ScenarioGridCard";
import { ScenarioTargetRow } from "./ScenarioTargetRow";
import type { ScenarioRunData } from "~/server/scenarios/scenario-event.types";
import type { ViewMode } from "./useRunHistoryStore";

const VIRTUALIZE_THRESHOLD = 30;
const GRID_CARD_HEIGHT = 200;
const GRID_GAP = 16;
const GRID_PADDING = 16;
const GRID_ROW_HEIGHT = GRID_CARD_HEIGHT + GRID_GAP;
const LIST_ROW_HEIGHT = 37;
const MIN_CARD_WIDTH = 250;

type ScenarioRunContentProps = {
  scenarioRuns: ScenarioRunData[];
  viewMode: ViewMode;
  resolveTargetName: (scenarioRun: ScenarioRunData) => string | null;
  onScenarioRunClick: (scenarioRun: ScenarioRunData) => void;
  iterationMap: Map<string, number>;
  onCancelRun?: (scenarioRun: ScenarioRunData) => void;
  cancellingJobId?: string | null;
};

/**
 * Wraps ScenarioGridCard so that onClick is derived from the scenarioRun ref
 * itself rather than a new closure per card. This lets memo() actually work.
 */
const StableGridCard = memo(function StableGridCard({
  scenarioRun,
  targetName,
  onScenarioRunClick,
  iteration,
}: {
  scenarioRun: ScenarioRunData;
  targetName: string | null;
  onScenarioRunClick: (scenarioRun: ScenarioRunData) => void;
  iteration?: number;
}) {
  const handleClick = useCallback(
    () => onScenarioRunClick(scenarioRun),
    [onScenarioRunClick, scenarioRun],
  );
  return (
    <ScenarioGridCard
      scenarioRun={scenarioRun}
      targetName={targetName}
      onClick={handleClick}
      iteration={iteration}
    />
  );
});

export function ScenarioRunContent(props: ScenarioRunContentProps) {
  if (props.scenarioRuns.length > VIRTUALIZE_THRESHOLD) {
    return <VirtualizedContent {...props} />;
  }
  return <PlainContent {...props} />;
}

// --- Non-virtualized (original) rendering for small lists ---

function PlainContent({
  scenarioRuns,
  viewMode,
  resolveTargetName,
  onScenarioRunClick,
  iterationMap,
  onCancelRun,
  cancellingJobId,
}: ScenarioRunContentProps) {
  if (viewMode === "grid") {
    return (
      <Grid
        templateColumns="repeat(auto-fill, minmax(250px, 1fr))"
        gap={4}
        padding={4}
        position="relative"
        zIndex={0}
        data-testid="scenario-grid"
      >
        {scenarioRuns.map((scenarioRun) => (
          <StableGridCard
            key={scenarioRun.scenarioRunId}
            scenarioRun={scenarioRun}
            targetName={resolveTargetName(scenarioRun)}
            onScenarioRunClick={onScenarioRunClick}
            iteration={iterationMap.get(scenarioRun.scenarioRunId)}
            onCancel={onCancelRun ? () => onCancelRun(scenarioRun) : undefined}
            isCancelling={cancellingJobId === scenarioRun.scenarioRunId}
          />
        ))}
      </Grid>
    );
  }

  return (
    <VStack align="stretch" gap={0} data-testid="scenario-list">
      {scenarioRuns.map((scenarioRun) => (
        <ScenarioTargetRow
          key={scenarioRun.scenarioRunId}
          scenarioRun={scenarioRun}
          targetName={resolveTargetName(scenarioRun)}
          onClick={() => onScenarioRunClick(scenarioRun)}
          iteration={iterationMap.get(scenarioRun.scenarioRunId)}
          onCancel={onCancelRun ? () => onCancelRun(scenarioRun) : undefined}
          isCancelling={cancellingJobId === scenarioRun.scenarioRunId}
        />
      ))}
    </VStack>
  );
}

// --- Virtualized rendering for large lists ---

function getScrollParent(element: HTMLElement): HTMLElement {
  let parent = element.parentElement;
  while (parent) {
    const style = getComputedStyle(parent);
    if (/(auto|scroll)/.test(style.overflow + style.overflowY)) {
      return parent;
    }
    parent = parent.parentElement;
  }
  return document.documentElement;
}

function VirtualizedContent({
  scenarioRuns,
  viewMode,
  resolveTargetName,
  onScenarioRunClick,
  iterationMap,
}: ScenarioRunContentProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [scrollElement, setScrollElement] = useState<HTMLElement | null>(null);
  const [columns, setColumns] = useState(1);

  const isGrid = viewMode === "grid";

  // Find scroll parent before first paint
  useLayoutEffect(() => {
    if (!containerRef.current) return;
    setScrollElement(getScrollParent(containerRef.current));
  }, []);

  // Measure columns for grid mode before first paint
  useLayoutEffect(() => {
    if (!containerRef.current || !isGrid) return;
    const available = containerRef.current.clientWidth - GRID_PADDING * 2;
    setColumns(
      Math.max(1, Math.floor((available + GRID_GAP) / (MIN_CARD_WIDTH + GRID_GAP))),
    );
  }, [isGrid]);

  // Keep columns updated on resize
  useEffect(() => {
    if (!containerRef.current || !isGrid) return;
    const el = containerRef.current;
    const observer = new ResizeObserver(() => {
      const available = el.clientWidth - GRID_PADDING * 2;
      setColumns(
        Math.max(1, Math.floor((available + GRID_GAP) / (MIN_CARD_WIDTH + GRID_GAP))),
      );
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [isGrid]);

  // Compute scrollMargin: distance from scroll element content-top to our container top.
  // This is stable regardless of scroll position (the scroll offset cancels out).
  let scrollMargin = 0;
  if (containerRef.current && scrollElement) {
    const containerRect = containerRef.current.getBoundingClientRect();
    const scrollRect = scrollElement.getBoundingClientRect();
    scrollMargin = Math.round(
      containerRect.top - scrollRect.top + scrollElement.scrollTop,
    );
  }

  const rowCount = isGrid
    ? Math.ceil(scenarioRuns.length / columns)
    : scenarioRuns.length;
  const rowHeight = isGrid ? GRID_ROW_HEIGHT : LIST_ROW_HEIGHT;

  const getScrollElementCb = useCallback(() => scrollElement, [scrollElement]);
  const estimateSize = useCallback(() => rowHeight, [rowHeight]);

  const virtualizer = useVirtualizer({
    count: rowCount,
    getScrollElement: getScrollElementCb,
    estimateSize,
    overscan: 5,
    scrollMargin,
    enabled: !!scrollElement,
  });

  const virtualItems = virtualizer.getVirtualItems();
  // getTotalSize() already excludes scrollMargin — it returns the pure content height.
  const contentHeight = virtualizer.getTotalSize();

  if (isGrid) {
    return (
      <div
        ref={containerRef}
        style={{
          height: contentHeight + GRID_PADDING * 2,
          width: "100%",
          position: "relative",
          flexShrink: 0,
        }}
        data-testid="scenario-grid"
      >
        {virtualItems.map((virtualRow) => {
          const startIdx = virtualRow.index * columns;
          const rowItems = scenarioRuns.slice(startIdx, startIdx + columns);
          return (
            <div
              key={virtualRow.index}
              style={{
                position: "absolute",
                top: GRID_PADDING,
                left: GRID_PADDING,
                right: GRID_PADDING,
                height: GRID_CARD_HEIGHT,
                transform: `translateY(${virtualRow.start - virtualizer.options.scrollMargin}px)`,
                display: "grid",
                gridTemplateColumns: `repeat(${columns}, 1fr)`,
                gap: GRID_GAP,
              }}
            >
              {rowItems.map((scenarioRun) => (
                <StableGridCard
                  key={scenarioRun.scenarioRunId}
                  scenarioRun={scenarioRun}
                  targetName={resolveTargetName(scenarioRun)}
                  onScenarioRunClick={onScenarioRunClick}
                  iteration={iterationMap.get(scenarioRun.scenarioRunId)}
                />
              ))}
            </div>
          );
        })}
      </div>
    );
  }

  // List mode
  return (
    <div
      ref={containerRef}
      style={{
        height: contentHeight,
        width: "100%",
        position: "relative",
        flexShrink: 0,
      }}
      data-testid="scenario-list"
    >
      {virtualItems.map((virtualItem) => {
        const scenarioRun = scenarioRuns[virtualItem.index];
        if (!scenarioRun) return null;
        return (
          <div
            key={scenarioRun.scenarioRunId}
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              width: "100%",
              height: virtualItem.size,
              transform: `translateY(${virtualItem.start - virtualizer.options.scrollMargin}px)`,
            }}
          >
            <ScenarioTargetRow
              scenarioRun={scenarioRun}
              targetName={resolveTargetName(scenarioRun)}
              onClick={() => onScenarioRunClick(scenarioRun)}
              iteration={iterationMap.get(scenarioRun.scenarioRunId)}
            />
          </div>
        );
      })}
    </div>
  );
}

