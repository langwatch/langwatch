import { Box, Button, HStack, Text } from "@chakra-ui/react";
import { MeshGradient } from "@paper-design/shaders-react";
import { Sparkles } from "lucide-react";
import type React from "react";
import { Tooltip } from "~/components/ui/tooltip";
import { useReducedMotion } from "~/hooks/useReducedMotion";
import { aiBrandPalette } from "./aiBrandPalette";

interface AskAiButtonProps {
  onClick: () => void;
  /** Tooltip copy. Defaults match the search bar's "tell us what you want…". */
  tooltip?: string;
  /** aria-label override. */
  ariaLabel?: string;
  /** Show "Ask AI" text alongside the icon. Defaults to true. */
  showLabel?: boolean;
}

/**
 * The brand "Ask AI" affordance — gradient-filled button with the
 * `Sparkles` icon and (optionally) the "Ask AI" label. Used in the
 * search bar to enter AI mode and in the lens-creation popover to
 * switch to the AI input. Same visuals everywhere so the AI surface
 * reads as one consistent feature.
 */
export const AskAiButton: React.FC<AskAiButtonProps> = ({
  onClick,
  tooltip = "Tell us what you want, and let AI make it happen",
  ariaLabel = "Enter AI mode",
  showLabel = true,
}) => {
  const reduceMotion = useReducedMotion();
  return (
    <Tooltip content={tooltip} openDelay={200}>
      <Button
        aria-label={ariaLabel}
        size="2xs"
        flexShrink={0}
        onClick={onClick}
        color="white"
        fontWeight="600"
        position="relative"
        overflow="hidden"
        bg="transparent"
        boxShadow="0 1px 4px rgba(168,85,247,0.25), 0 0 0 1px rgba(255,95,31,0.12)"
        _dark={{ boxShadow: "0 1px 4px rgba(168,85,247,0.18)" }}
        _hover={{ filter: "brightness(1.08)" }}
      >
        <Box
          position="absolute"
          inset={0}
          zIndex={0}
          pointerEvents="none"
          _dark={{ opacity: 0.7 }}
        >
          <MeshGradient
            colors={aiBrandPalette}
            distortion={0.5}
            swirl={0.5}
            grainMixer={0}
            grainOverlay={0}
            speed={reduceMotion ? 0 : 0.4}
            scale={1.5}
            style={{ width: "100%", height: "100%" }}
          />
        </Box>
        <HStack gap={1} position="relative" zIndex={1}>
          <Sparkles size={11} />
          {showLabel && <Text textStyle="xs">Ask AI</Text>}
        </HStack>
      </Button>
    </Tooltip>
  );
};
