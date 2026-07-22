import { Box, HStack, Text } from "@chakra-ui/react";
import { Sparkles } from "lucide-react";
import { motion } from "motion/react";
import type React from "react";
import { useState } from "react";
import { createPortal } from "react-dom";
import { filterContextChip } from "~/features/langy/hooks/useLangyFilterContext";
import { useFilterStore } from "../../stores/filterStore";
import { AiPromptInput } from "../ai/AiPromptInput";
import { AiShaderBackdrop } from "./AiShaderBackdrop";
import type { FloatRect } from "./useFloatRect";

interface FloatingLangyBarProps {
  rect: FloatRect | null;
  onClose: () => void;
  /**
   * Hand the typed question to Langy — the panel opens (asking `typedText`
   * when non-empty) and the applied search rides along as attached context.
   * The caller wires this to `useAskLangyFromSearch().askLangyFromSearch`.
   */
  onAsk: (typedText?: string) => void;
}

const LANGY_PROMPTS = [
  "Ask Langy about these traces…",
  "Try: why did errors spike this morning?",
  "Maybe: what do these failures have in common?",
  "How about: summarise what changed today",
] as const;

/**
 * A Langy-styled ask surface anchored over the search bar — so the question
 * is typed at the top of the trace explorer, next to the traces it is about,
 * instead of over in the docked panel. Same portal/rect mechanics as
 * {@link FloatingAiBar}; on Enter the question hands off to the Langy panel
 * and this bar dissolves. The SearchBar only mounts it while the Langy panel
 * is closed — an open panel is already the place to type.
 *
 * Spec: specs/traces-v2/search.feature ("The search bar's ask affordance
 * belongs to Langy when Langy is available").
 */
export const FloatingLangyBar: React.FC<FloatingLangyBarProps> = ({
  rect,
  onClose,
  onAsk,
}) => {
  const [prompt, setPrompt] = useState("");
  // Show what will ride along, so "these traces" is never a surprise: the
  // applied search travels with the question as context on the panel.
  const queryText = useFilterStore((s) => s.queryText);
  const ridingAlong = filterContextChip(queryText);

  if (typeof document === "undefined" || !rect) return null;
  return createPortal(
    <>
      <motion.div
        style={{
          position: "fixed",
          top: `${rect.top}px`,
          left: `${rect.left}px`,
          width: `${rect.width}px`,
          zIndex: 30,
          minHeight: "38px",
          borderTopLeftRadius: "var(--chakra-radii-lg)",
          boxShadow:
            "0 4px 12px rgba(237,137,38,0.12), 0 2px 6px rgba(0,0,0,0.06)",
        }}
        initial={{ opacity: 0, filter: "blur(10px)" }}
        animate={{ opacity: 1, filter: "blur(0px)" }}
        exit={{ opacity: 0, filter: "blur(10px)" }}
        transition={{ duration: 0.38, ease: [0.16, 1, 0.3, 1] }}
      >
        <AiShaderBackdrop />
        <Box
          position="absolute"
          top="1.5px"
          left="1.5px"
          right="1.5px"
          bottom="1.5px"
          bg="bg.surface/92"
          borderTopLeftRadius="lg"
          borderTopRightRadius={0}
          borderBottomLeftRadius={0}
          borderBottomRightRadius={0}
          display="flex"
          alignItems="center"
          paddingX={3}
          paddingY={1.5}
          gap={2}
          zIndex={1}
        >
          <AiPromptInput
            prompt={prompt}
            onPromptChange={setPrompt}
            onSubmit={() => {
              // An empty Enter still goes to Langy — the panel opens ready to
              // type, mirroring the command bar's empty-composer handoff.
              onAsk(prompt);
              onClose();
            }}
            onClose={onClose}
            isPending={false}
            placeholderExamples={LANGY_PROMPTS}
          />
        </Box>
      </motion.div>
      <motion.div
        style={{
          position: "fixed",
          top: `${rect.top + 38 + 2}px`,
          left: `${rect.left}px`,
          width: `${rect.width}px`,
          zIndex: 31,
          // Informational strip only — stay click-transparent so it never
          // blocks the trace list underneath.
          pointerEvents: "none",
        }}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.32, ease: [0.16, 1, 0.3, 1], delay: 0.08 }}
      >
        <Box paddingX={3} display="flex" justifyContent="flex-start">
          <HStack
            gap={1.5}
            align="center"
            bg="bg.panel"
            borderWidth="1px"
            borderColor="border.subtle"
            borderRadius="md"
            paddingX={2}
            paddingY={1}
            boxShadow="0 2px 6px rgba(0,0,0,0.1)"
          >
            <Sparkles size={11} />
            <Text textStyle="2xs" color="fg.muted" lineHeight="1.3">
              {ridingAlong
                ? `Goes with your question: ${ridingAlong.label}`
                : "Enter to ask Langy · Esc to cancel"}
            </Text>
          </HStack>
        </Box>
      </motion.div>
    </>,
    document.body,
  );
};
