import { useCallback, useMemo } from "react";
import { selectTraceInputBaseline, useTraceEditStore } from "../../../../../index";
import { EditableIOField } from "./editable-io-field";

/**
 * The trace's own input editor. A dataset record is built from the trace's
 * input as well as its output, so a question the trace recorded badly has to be
 * correctable where the reviewer is reading it.
 */
export function TraceEditableInput({ capturedText }: { capturedText: string | null }) {
  const basePatch = useTraceEditStore((s) => s.basePatch);
  const draft = useTraceEditStore((s) => s.traceInputDraft);
  const setTraceInput = useTraceEditStore((s) => s.setTraceInput);
  const resetTraceInput = useTraceEditStore((s) => s.resetTraceInput);

  const baseline = useMemo(
    () => selectTraceInputBaseline(basePatch) ?? capturedText,
    [basePatch, capturedText],
  );

  const handleChange = useCallback(
    (text: string) => setTraceInput({ text, baselineText: baseline ?? null }),
    [setTraceInput, baseline],
  );

  return (
    <EditableIOField
      label="Input"
      captured={baseline}
      draft={draft?.text}
      onChange={handleChange}
      onReset={resetTraceInput}
    />
  );
}
