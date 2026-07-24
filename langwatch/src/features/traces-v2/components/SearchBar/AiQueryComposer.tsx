import type React from "react";
import { useEffect, useRef, useState } from "react";
import { useFilterStore } from "../../stores/filterStore";
import { AiPromptInput } from "../ai/AiPromptInput";
import { useAiTraceAction } from "../ai/useAiTraceAction";

interface AiQueryComposerProps {
  onClose: () => void;
  onPendingChange?: (pending: boolean) => void;
  /**
   * Seed value for the prompt input. Used when the user typed something
   * into the search bar and then hit ⌘I / clicked Ask AI — without this
   * the typed text gets wiped and the user has to re-type.
   */
  initialPrompt?: string;
  /**
   * When true, submit the `initialPrompt` automatically on mount. Wired
   * to the ⌘+⏎ shortcut in the search bar so a typed free-text query
   * can be punted to Ask AI in one keystroke instead of "enter AI mode,
   * then press Enter again".
   */
  autoSubmit?: boolean;
}

const PLACEHOLDERS = [
  "Describe what you're looking for…",
  "Try: errors in the last hour",
  "Maybe: slow GPT-4 calls today",
  "How about: traces with negative feedback",
  "Why not: completions over $1",
  "Like: tool call failures since yesterday",
];

export const AiQueryComposer: React.FC<AiQueryComposerProps> = ({
  onClose,
  onPendingChange,
  initialPrompt = "",
  autoSubmit = false,
}) => {
  const [prompt, setPrompt] = useState(initialPrompt);
  const { submit, isPending, error, clearError } = useAiTraceAction({
    mode: "filter",
    onDone: onClose,
  });
  const setAiError = useFilterStore((s) => s.setAiError);

  useEffect(() => {
    onPendingChange?.(isPending);
  }, [isPending, onPendingChange]);

  // Push AI errors into the filter store so the unified banner in SearchBar
  // can display them. The error persists after this composer unmounts —
  // intentional: the user should see the failure even after closing AI mode.
  useEffect(() => {
    setAiError(error);
  }, [error, setAiError]);

  // Auto-submit on mount when the caller seeded a prompt AND asked us
  // to fire it without a second Enter keystroke. Guarded by a ref so the
  // submission never repeats on a re-render (e.g. when the parent's
  // pending state flips back and forth).
  const autoSubmittedRef = useRef(false);
  useEffect(() => {
    if (!autoSubmit) return;
    if (autoSubmittedRef.current) return;
    if (!initialPrompt.trim()) return;
    autoSubmittedRef.current = true;
    submit(initialPrompt);
  }, [autoSubmit, initialPrompt, submit]);

  return (
    <AiPromptInput
      prompt={prompt}
      onPromptChange={(next) => {
        setPrompt(next);
        if (error) {
          clearError();
          setAiError(null);
        }
      }}
      onSubmit={() => submit(prompt)}
      onClose={onClose}
      isPending={isPending}
      placeholderExamples={PLACEHOLDERS}
    />
  );
};
