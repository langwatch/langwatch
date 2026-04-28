import { Box, HStack, Icon, Text } from "@chakra-ui/react";
import { Lightbulb } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import type React from "react";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { AiQueryComposer } from "./AiQueryComposer";
import { AiShaderBackdrop } from "./AiShaderBackdrop";
import type { FloatRect } from "./useFloatRect";

interface FloatingAiBarProps {
  rect: FloatRect | null;
  onClose: () => void;
}

const AI_TIPS = [
  "Save the result as a lens with the + button next to your lenses.",
  "Press Enter to apply, Esc to cancel.",
  "Don't know the syntax? AI's got your back — just describe what you want.",
];

const useCyclingTip = (active: boolean): string => {
  const [index, setIndex] = useState(0);
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => {
      setIndex((i) => (i + 1) % AI_TIPS.length);
    }, 4200);
    return () => clearInterval(id);
  }, [active]);
  return AI_TIPS[index] ?? AI_TIPS[0]!;
};

/**
 * Portaled overlay that replaces the search bar with the AI query composer
 * while in AI mode. Anchored to a measured rect from {@link useFloatRect}.
 */
export const FloatingAiBar: React.FC<FloatingAiBarProps> = ({
  rect,
  onClose,
}) => {
  const [pending, setPending] = useState(false);
  const tip = useCyclingTip(!pending);
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
            "0 4px 12px rgba(168,85,247,0.12), 0 2px 6px rgba(0,0,0,0.06)",
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
          <AiQueryComposer onClose={onClose} onPendingChange={setPending} />
        </Box>
      </motion.div>
      <motion.div
        style={{
          position: "fixed",
          top: `${rect.top + 38 + 2}px`,
          left: `${rect.left}px`,
          width: `${rect.width}px`,
          zIndex: 31,
          pointerEvents: "none",
        }}
        initial={{ opacity: 0, y: -4 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -4 }}
        transition={{ duration: 0.32, ease: [0.16, 1, 0.3, 1], delay: 0.08 }}
      >
        <Box paddingX={3} display="flex" justifyContent="flex-start">
          <AnimatePresence mode="wait">
            <motion.div
              key={tip}
              initial={{ opacity: 0, y: 2 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -2 }}
              transition={{ duration: 0.28 }}
            >
              <HStack
                gap={1.5}
                align="center"
                bg="bg.panel/90"
                backdropFilter="blur(8px)"
                borderWidth="1px"
                borderColor="border.subtle"
                borderRadius="md"
                paddingX={2}
                paddingY={1}
                boxShadow="0 2px 6px rgba(0,0,0,0.1)"
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
        </Box>
      </motion.div>
    </>,
    document.body,
  );
};
