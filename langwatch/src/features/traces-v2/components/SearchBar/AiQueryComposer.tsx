import { Box, HStack, VStack } from "@chakra-ui/react";
import type React from "react";
import { useEffect, useState } from "react";
import { AiPromptInput } from "../ai/AiPromptInput";
import { useAiTraceAction } from "../ai/useAiTraceAction";

interface AiQueryComposerProps {
  onClose: () => void;
  onPendingChange?: (pending: boolean) => void;
}

type AiMode = "search" | "lens";

const MODE_PLACEHOLDERS: Record<AiMode, string[]> = {
  search: [
    "Describe what you're looking for…",
    "Try: errors in the last hour",
    "Maybe: slow GPT-4 calls today",
    "How about: traces with negative feedback",
    "Why not: completions over $1",
    "Like: tool call failures since yesterday",
  ],
  lens: [
    "Describe the lens you want to save…",
    "A view of failing GPT-4 calls",
    "Slow simulations from yesterday",
    "Traces with negative feedback",
    "Tool call failures over $0.50",
  ],
};

/**
 * Search-bar AI composer with an explicit mode toggle. The user picks
 * whether the AI should filter the current view (`Search`) or create a
 * new saved lens (`Create lens`) — keeps the contract clear instead of
 * leaving it to the model to guess intent.
 */
export const AiQueryComposer: React.FC<AiQueryComposerProps> = ({
  onClose,
  onPendingChange,
}) => {
  const [prompt, setPrompt] = useState("");
  const [mode, setMode] = useState<AiMode>("search");
  const { submit, isPending, error, clearError } = useAiTraceAction({
    mode: mode === "lens" ? "lens" : "filter",
    onDone: onClose,
  });

  useEffect(() => {
    onPendingChange?.(isPending);
  }, [isPending, onPendingChange]);

  return (
    <VStack align="stretch" gap={1.5} width="full">
      <HStack gap={1} align="center" paddingLeft="22px">
        {/* Indented to align under the prompt input (the sparkles icon to
            the left has its own slot) — the mode pills sit above the
            text where the user is about to type. */}
        <ModePill
          active={mode === "search"}
          onClick={() => setMode("search")}
          disabled={isPending}
        >
          Search
        </ModePill>
        <ModePill
          active={mode === "lens"}
          onClick={() => setMode("lens")}
          disabled={isPending}
        >
          Create lens
        </ModePill>
      </HStack>
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
        placeholderExamples={MODE_PLACEHOLDERS[mode]}
      />
    </VStack>
  );
};

interface ModePillProps {
  active: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}

const ModePill: React.FC<ModePillProps> = ({
  active,
  disabled,
  onClick,
  children,
}) => (
  <Box
    as="button"
    onClick={onClick}
    disabled={disabled}
    type="button"
    fontSize="2xs"
    fontWeight="600"
    paddingX={2}
    paddingY={0.5}
    borderRadius="full"
    color={active ? "fg" : "fg.muted"}
    bg={active ? "bg.muted" : "transparent"}
    _hover={!disabled && !active ? { bg: "bg.subtle", color: "fg" } : undefined}
    _disabled={{ opacity: 0.5, cursor: "not-allowed" }}
    cursor={disabled ? "not-allowed" : "pointer"}
    transition="background 0.12s, color 0.12s"
  >
    {children}
  </Box>
);
