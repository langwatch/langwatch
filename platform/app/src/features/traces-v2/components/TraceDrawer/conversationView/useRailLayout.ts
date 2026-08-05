import { type RefObject, useEffect, useState } from "react";
import type { Mode } from "./types";

/** How wide the reading column gets before the rail is taken into account. */
export const THREAD_COLUMN_MAX_WIDTH_PX = 800;

/** Space between the turn and its rail, matching a Chakra `gap={3}`. */
export const RAIL_GAP_PX = 12;

/** The rail's width when the pane has room for it. */
export const RAIL_WIDTH_WIDE_PX = 320;

/**
 * The rail's width once the pane starts to pinch. Narrow enough to keep a
 * readable message column beside it, wide enough for a comment and a row of
 * score chips.
 */
export const RAIL_WIDTH_SLIM_PX = 280;

/** Under this pane width the rail gives up its full width. */
export const RAIL_SLIM_BELOW_PX = 800;

/**
 * Under this pane width the rail moves below the turn. At this point a slim
 * rail beside the message would leave the message under ~300px, which reads
 * worse than the same two blocks stacked.
 */
export const RAIL_STACK_BELOW_PX = 640;

export type RailMode = "side" | "stacked";

export interface RailLayout {
  mode: RailMode;
  /** Width of the rail column in side mode. Ignored when stacked. */
  railWidth: number;
}

const WIDE_LAYOUT: RailLayout = {
  mode: "side",
  railWidth: RAIL_WIDTH_WIDE_PX,
};

/**
 * The rail's shape for a given pane width, biased towards keeping it beside
 * the turn: the message column is squeezed and the rail is slimmed before
 * either of them moves.
 *
 * A width of 0 means nothing has been measured yet, which resolves to the
 * wide layout so the first paint matches the common case.
 */
export function resolveRailLayout(paneWidth: number): RailLayout {
  if (paneWidth <= 0) return WIDE_LAYOUT;
  if (paneWidth < RAIL_STACK_BELOW_PX) {
    return { mode: "stacked", railWidth: RAIL_WIDTH_SLIM_PX };
  }
  if (paneWidth < RAIL_SLIM_BELOW_PX) {
    return { mode: "side", railWidth: RAIL_WIDTH_SLIM_PX };
  }
  return WIDE_LAYOUT;
}

/**
 * Whether the conversation has a rail at all. Nothing reserves room for one
 * until there is a card or a composer to hold, which is what keeps an
 * un-annotated conversation reading exactly as it did before the rail existed.
 *
 * The composer is checked against this conversation's turns rather than just
 * "some composer is open": the queue page and the trace drawer can each be
 * showing a conversation at the same time, and only the one being annotated
 * should change shape.
 */
export function isRailActive({
  layout,
  hasAnnotations,
  draftTraceId,
  turnTraceIds,
}: {
  layout: Mode;
  hasAnnotations: boolean;
  draftTraceId: string | null;
  turnTraceIds: ReadonlySet<string>;
}): boolean {
  if (layout !== "thread") return false;
  if (hasAnnotations) return true;
  return !!draftTraceId && turnTraceIds.has(draftTraceId);
}

/**
 * How wide the centered column may grow. With a rail beside it the column
 * carries both, so it grows to fit; without one nothing reserves space and the
 * reading width is unchanged.
 */
export function threadColumnMaxWidth({
  isActive,
  layout,
}: {
  isActive: boolean;
  layout: RailLayout;
}): string {
  if (!isActive || layout.mode === "stacked") {
    return `${THREAD_COLUMN_MAX_WIDTH_PX}px`;
  }
  return `${THREAD_COLUMN_MAX_WIDTH_PX + RAIL_GAP_PX + layout.railWidth}px`;
}

/**
 * Track the conversation scroller's width and resolve the rail's shape from
 * it. One ResizeObserver for the whole conversation, throttled to a frame, and
 * state only ever set on a real flip so a resize that changes nothing cannot
 * feed itself another layout pass.
 */
export function useRailLayout(
  scrollerRef: RefObject<HTMLElement | null>,
): RailLayout {
  const [layout, setLayout] = useState<RailLayout>(WIDE_LAYOUT);

  useEffect(() => {
    const el = scrollerRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;

    let frame: number | null = null;
    const measure = () => {
      frame = null;
      const next = resolveRailLayout(el.getBoundingClientRect().width);
      setLayout((current) =>
        current.mode === next.mode && current.railWidth === next.railWidth
          ? current
          : next,
      );
    };
    const schedule = () => {
      if (frame !== null) return;
      if (typeof requestAnimationFrame !== "function") {
        measure();
        return;
      }
      frame = requestAnimationFrame(measure);
    };

    schedule();
    const observer = new ResizeObserver(schedule);
    observer.observe(el);
    return () => {
      observer.disconnect();
      if (frame !== null) cancelAnimationFrame(frame);
    };
  }, [scrollerRef]);

  return layout;
}
