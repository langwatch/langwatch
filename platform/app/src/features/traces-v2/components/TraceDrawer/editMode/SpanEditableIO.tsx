import { useCallback, useMemo } from "react";
import {
  selectSpanEditBaseline,
  useTraceEditStore,
} from "../../../stores/traceEditStore";
import { EditableIOField } from "./EditableIOField";

/**
 * The span input or output editor, wired to the draft. Sits between the
 * accordion (which knows the captured value) and the field (which knows how to
 * edit text), so neither has to know about the store.
 */
export function SpanEditableIO({
  spanId,
  field,
  label,
  capturedText,
}: {
  spanId: string;
  field: "input" | "output";
  label: string;
  capturedText: string | null;
}) {
  const basePatch = useTraceEditStore((s) => s.basePatch);
  const draft = useTraceEditStore((s) => s.spanDrafts[spanId]?.[field]);
  const setSpanIO = useTraceEditStore((s) => s.setSpanIO);
  const resetSpanField = useTraceEditStore((s) => s.resetSpanField);

  // A correction already stored for this field is what the editor starts from,
  // so a second pass builds on the first instead of reverting it.
  const baseline = useMemo(
    () => selectSpanEditBaseline({ basePatch, spanId })[field] ?? capturedText,
    [basePatch, spanId, field, capturedText],
  );

  const handleChange = useCallback(
    (text: string) =>
      setSpanIO({ spanId, field, text, baselineText: baseline ?? null }),
    [setSpanIO, spanId, field, baseline],
  );

  const handleReset = useCallback(
    () => resetSpanField({ spanId, field }),
    [resetSpanField, spanId, field],
  );

  return (
    <EditableIOField
      label={label}
      captured={baseline}
      draft={draft?.text}
      onChange={handleChange}
      onReset={handleReset}
    />
  );
}
