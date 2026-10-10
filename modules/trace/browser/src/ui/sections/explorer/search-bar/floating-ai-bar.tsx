import { Box, HStack, Icon, Text } from "@langwatch/design-system/primitives";
import { isAggregateProjectKind } from "@langwatch/project-contract";
import { Lightbulb } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import type React from "react";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

import { useFilterStore } from "../../../../behavior/explorer.store.ts";
import type { FloatRect } from "../../../../behavior/use-float-rect.ts";
import { useOrganizationTeamProject } from "../../../../behavior/use-organization-team-project.ts";
import { AiQueryComposer } from "./ai-query-composer.tsx";
import { AiShaderBackdrop } from "./ai-shader-backdrop.tsx";
import { FloatingAiErrorRow } from "./floating-ai-error-row.tsx";

interface FloatingAiBarProps {
  rect: FloatRect | null;
  onClose: () => void;
  initialPrompt?: string;
  /** Forward to AiQueryComposer — fires submit on mount when set. */
  autoSubmit?: boolean;
}

const SAVE_AS_LENS_TIP = "Save the result as a lens with the + button next to your lenses.";

const GENERAL_TIPS = [
  "Press Enter to apply, Esc to cancel.",
  "Don't know the syntax? AI's got your back. Just describe what you want.",
];

/** Tips for a project that can save lenses: the "+" tip leads. */
const TIPS_WITH_LENS_SAVE = [SAVE_AS_LENS_TIP, ...GENERAL_TIPS];

/**
 * Cycles the composer tips. An aggregate project has no "+" to save a lens
 * (ADR-177), so its tips leave out the one that points to it.
 */
const useCyclingTip = (active: boolean): string => {
  const { project } = useOrganizationTeamProject();
  const canSaveLenses = !isAggregateProjectKind(project?.kind);
  const tips = canSaveLenses ? TIPS_WITH_LENS_SAVE : GENERAL_TIPS;
  const [index, setIndex] = useState(0);
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => {
      setIndex((i) => i + 1);
    }, 4200);
    return () => clearInterval(id);
  }, [active]);
  return tips[index % tips.length]!;
};

/**
 * Portaled overlay that replaces the search bar with the AI query composer
 * while in AI mode. Anchored to a measured rect from {@link useFloatRect}.
 */
export const FloatingAiBar: React.FC<FloatingAiBarProps> = ({
  rect,
  onClose,
  initialPrompt,
  autoSubmit,
}) => {
  const [pending, setPending] = useState(false);
  const tip = useCyclingTip(!pending);
  // The floating bar covers the docked search bar's unified error banner,
  // so failures must render here — the tip row swaps to an error row.
  const aiError = useFilterStore((s) => s.aiError);
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
            "0 4px 12px color-mix(in srgb, var(--chakra-colors-accent-solid) 12%, transparent), 0 2px 6px color-mix(in srgb, var(--chakra-colors-bg-scrim) 6%, transparent)",
        }}
        initial={{ opacity: 0, filter: "blur(10px)" }}
        animate={{ opacity: 1, filter: "blur(0px)" }}
        exit={{ opacity: 0, filter: "blur(10px)" }}
        transition={{ duration: 0.38, ease: [0.16, 1, 0.3, 1] }}
      >
        <AiShaderBackdrop active={pending} />
        <Box
          position="absolute"
          top="1.5px"
          left="1.5px"
          right="1.5px"
          bottom="1.5px"
          bg="bg.card/92"
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
          <AiQueryComposer
            onClose={onClose}
            onPendingChange={setPending}
            initialPrompt={initialPrompt}
            autoSubmit={autoSubmit}
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
          // The strip spans the whole search-bar width; keep it
          // click-transparent so it never blocks the UI underneath. The
          // error row (settings link, details expander, dismiss) opts its
          // own box back in with pointerEvents="auto".
          pointerEvents: "none",
        }}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.32, ease: [0.16, 1, 0.3, 1], delay: 0.08 }}
      >
        <Box paddingX={3} display="flex" justifyContent="flex-start">
          {aiError && !pending ? (
            <FloatingAiErrorRow error={aiError} />
          ) : (
            <AnimatePresence mode="wait">
              <motion.div
                key={tip}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.28 }}
              >
                <HStack
                  gap={1.5}
                  align="center"
                  bg="bg.panel"
                  borderWidth="1px"
                  borderColor="border.subtle"
                  borderRadius="md"
                  paddingX={2}
                  paddingY={1}
                  boxShadow="0 2px 6px color-mix(in srgb, var(--chakra-colors-bg-scrim) 10%, transparent)"
                >
                  <Icon color="yellow.fg" boxSize="11px" flexShrink={0}>
                    <Lightbulb />
                  </Icon>
                  <Text textStyle="2xs" color="fg.muted" lineHeight="1.3">
                    {tip}
                  </Text>
                </HStack>
              </motion.div>
            </AnimatePresence>
          )}
        </Box>
      </motion.div>
    </>,
    document.body,
  );
};
