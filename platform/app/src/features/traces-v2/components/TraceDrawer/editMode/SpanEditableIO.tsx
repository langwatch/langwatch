import { useCallback, useMemo } from "react";
import {
  selectSpanEditBaseline,
  useTraceEditStore,
} from "@langwatch/trace-web";
import { EditableIOField } from "./EditableIOField";
import { capturedInputForEditing } from "./spanInputSeed";

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
  capturedParams,
}: {
  spanId: string;
  field: "input" | "output";
  label: string;
  capturedText: string | null;
  /**
   * The span's attributes, which the input editor needs because the panel
   * renders the system prompt from them as a message. Only the input is
   * affected; the output carries nothing from the attributes.
   */
  capturedParams?: Record<string, unknown> | null;
}) {
  const basePatch = useTraceEditStore((s) => s.basePatch);
  const draft = useTraceEditStore((s) => s.spanDrafts[spanId]?.[field]);
  const setSpanIO = useTraceEditStore((s) => s.setSpanIO);
  const resetSpanField = useTraceEditStore((s) => s.resetSpanField);

  // The reader's input panel prepends the span's system prompt to the
  // transcript; the trace stores it as an attribute instead. Editing what is on
  // screen would save the prompt into the correction as well, so it comes back
  // out before the editor is seeded. See `capturedInputForEditing`.
  const captured = useMemo(
    () =>
      field === "input"
        ? capturedInputForEditing({
            text: capturedText,
            params: capturedParams,
          })
        : capturedText,
    [field, capturedText, capturedParams],
  );

  // A correction already stored for this field is what the editor starts from,
  // so a second pass builds on the first instead of reverting it.
  const baseline = useMemo(
    () => selectSpanEditBaseline({ basePatch, spanId })[field] ?? captured,
    [basePatch, spanId, field, captured],
  );

  const handleChange = useCallback(
    (text: string) => setSpanIO({ spanId, field, text, baselineText: baseline ?? null }),
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
