import { useCallback } from "react";
import type { FocusSection } from "../../../../index";
import {
  isFocusSection,
  useDrawerStore,
  useFocusSectionStore,
  useSpanPulseStore,
} from "../../../../index";

/** A comment's anchor as it comes back from a read. */
export interface AnnotationAnchorTarget {
  /** The trace the comment is on, which tells its own parts from a span's. */
  traceId: string;
  anchorKind: string | null;
  anchorId: string | null;
  anchorPath: string | null;
}

/**
 * The section of the detail stack holding a field, or null when this build has no
 * section for it.
 */
export function focusSectionForAnchorPath(
  anchorPath: string | null | undefined,
): FocusSection | null {
  if (!anchorPath) return null;
  const head = anchorPath.split(".")[0]!;
  if (head === "input" || head === "output" || head === "error") return "io";
  if (head === "params" || head === "metadata") return "attributes";
  return isFocusSection(head) ? head : null;
}

/**
 * Whether a comment's anchor is something the reader can be taken to.
 */
export function canJumpToAnnotationAnchor({
  anchor,
  resolvable,
}: {
  anchor: Pick<AnnotationAnchorTarget, "anchorKind" | "anchorId" | "traceId">;
  /** Ids the trace still holds: its span ids, plus the trace's own id. */
  resolvable: ReadonlySet<string>;
}): boolean {
  if (!anchor.anchorKind || !anchor.anchorId) return false;
  if (anchor.anchorKind !== "span" && anchor.anchorKind !== "field") {
    return false;
  }
  return resolvable.has(anchor.anchorId);
}

/**
 * Takes the reader to the part of the trace a comment is about: the trace view, the
 * span selected and flashed in the waterfall, and the section holding the field open
 * and briefly haloed.
 */
export function useJumpToAnnotationAnchor(): (anchor: AnnotationAnchorTarget) => void {
  const openSpanInTrace = useDrawerStore((s) => s.openSpanInTrace);
  const clearSpan = useDrawerStore((s) => s.clearSpan);
  const setViewModeTransient = useDrawerStore((s) => s.setViewModeTransient);
  const requestFocus = useFocusSectionStore((s) => s.request);

  return useCallback(
    ({ traceId, anchorKind, anchorId, anchorPath }: AnnotationAnchorTarget) => {
      if (!anchorKind || !anchorId) return;
      if (anchorKind !== "span" && anchorKind !== "field") return;

      if (anchorId === traceId) {
        // The trace's own fields read in the summary, which is what the detail
        // pane shows while no span is selected.
        clearSpan();
        setViewModeTransient("trace");
      } else {
        openSpanInTrace(anchorId);
        useSpanPulseStore.getState().pulse(anchorId);
      }

      const section = focusSectionForAnchorPath(anchorPath);
      if (section) requestFocus({ traceId, section });
    },
    [openSpanInTrace, clearSpan, setViewModeTransient, requestFocus],
  );
}
