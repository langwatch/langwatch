import { useCallback, useMemo } from "react";
import {
  selectTraceOutputBaseline,
  useTraceEditStore,
} from "../../../stores/traceEditStore";
import { EditableIOField } from "./EditableIOField";

/**
 * The trace's own output editor. This is the field the curation loop cares
 * about most, because it is what a dataset record's expected output is built
 * from, which is why the edit bar has a jump straight to it.
 */
export function TraceEditableOutput({ capturedText }: { capturedText: string | null }) {
  const basePatch = useTraceEditStore((s) => s.basePatch);
  const draft = useTraceEditStore((s) => s.traceOutputDraft);
  const setTraceOutput = useTraceEditStore((s) => s.setTraceOutput);
  const resetTraceOutput = useTraceEditStore((s) => s.resetTraceOutput);

  const baseline = useMemo(
    () => selectTraceOutputBaseline(basePatch) ?? capturedText,
    [basePatch, capturedText],
  );

  const handleChange = useCallback(
    (text: string) => setTraceOutput({ text, baselineText: baseline ?? null }),
    [setTraceOutput, baseline],
  );

  return (
    <EditableIOField
      label="Output"
      captured={baseline}
      draft={draft?.text}
      onChange={handleChange}
      onReset={resetTraceOutput}
    />
  );
}
