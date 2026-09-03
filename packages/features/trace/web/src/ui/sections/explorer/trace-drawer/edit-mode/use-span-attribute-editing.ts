import { useCallback, useMemo } from "react";
import { selectSpanParamsBaseline, useTraceEditStore } from "../../../../../index";
import type { AttributeEditing } from "../attribute-table";

/**
 * Connects the attributes table to the draft: the values it starts from and
 * the two callbacks that record a change. Returns state and callbacks only:
 * the table renders itself.
 */
export function useSpanAttributeEditing({
  spanId,
  capturedParams,
  enabled,
}: {
  spanId: string;
  capturedParams: Record<string, unknown>;
  enabled: boolean;
}): {
  baselineParams: Record<string, unknown>;
  editing: AttributeEditing | undefined;
} {
  const basePatch = useTraceEditStore((s) => s.basePatch);
  const edits = useTraceEditStore((s) => s.spanDrafts[spanId]?.params);
  const setSpanParam = useTraceEditStore((s) => s.setSpanParam);
  const resetSpanParam = useTraceEditStore((s) => s.resetSpanParam);

  const baselineParams = useMemo(
    () =>
      selectSpanParamsBaseline({
        basePatch,
        spanId,
        captured: capturedParams,
      }),
    [basePatch, spanId, capturedParams],
  );

  const onEditAttribute = useCallback(
    ({ key, value }: { key: string; value: unknown }) =>
      setSpanParam({ spanId, key, value, baselineParams }),
    [setSpanParam, spanId, baselineParams],
  );

  const onResetAttribute = useCallback(
    (key: string) => resetSpanParam({ spanId, key }),
    [resetSpanParam, spanId],
  );

  const editing = useMemo(
    () => (enabled ? { edits: edits ?? {}, onEditAttribute, onResetAttribute } : undefined),
    [enabled, edits, onEditAttribute, onResetAttribute],
  );

  return { baselineParams, editing };
}
