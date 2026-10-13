import type { editor } from "monaco-editor";
import { useEffect } from "react";

/**
 * Writes a value the host changed (a reset, a preset) into an uncontrolled Monaco editor.
 * Typing flows out through onChange and is never written back: a controlled `value` lags a
 * fast typist, replaces the whole model with older text and closes the completion list.
 */
export function useEditorValueSync({
  editor: mounted,
  value,
}: {
  editor: Pick<editor.IStandaloneCodeEditor, "hasTextFocus" | "getValue" | "setValue"> | undefined;
  value: string;
}): void {
  useEffect(() => {
    if (!mounted || mounted.hasTextFocus() || mounted.getValue() === value) return;
    mounted.setValue(value);
  }, [mounted, value]);
}
