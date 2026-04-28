import type React from "react";
import { useEffect, useState } from "react";
import { AiPromptInput } from "../ai/AiPromptInput";
import { useAiTraceAction } from "../ai/useAiTraceAction";

interface AiQueryComposerProps {
  onClose: () => void;
  onPendingChange?: (pending: boolean) => void;
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
}) => {
  const [prompt, setPrompt] = useState("");
  const { submit, isPending, error, clearError } = useAiTraceAction({
    mode: "filter",
    onDone: onClose,
  });

  useEffect(() => {
    onPendingChange?.(isPending);
  }, [isPending, onPendingChange]);

  return (
    <AiPromptInput
      prompt={prompt}
      onPromptChange={(next) => {
        setPrompt(next);
        if (error) clearError();
      }}
      onSubmit={() => submit(prompt)}
      onClose={onClose}
      isPending={isPending}
      error={error}
      placeholderExamples={PLACEHOLDERS}
    />
  );
};
