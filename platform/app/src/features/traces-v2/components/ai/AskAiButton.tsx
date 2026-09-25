import { Box, Button, HStack, Text } from "@chakra-ui/react";
import { keyframes } from "@emotion/react";
import { MeshGradient } from "@paper-design/shaders-react";
import { Sparkles } from "lucide-react";
import React from "react";
import { Kbd } from "~/components/ops/shared/Kbd";
import { useColorModeValue } from "~/components/ui/color-mode";
import { Tooltip } from "~/components/ui/tooltip";
import { useReducedMotion } from "~/hooks/useReducedMotion";
import { aiBrandPalette, aiBrandPaletteHot } from "./aiBrandPalette";
import { ProviderPrimerPopover } from "./ProviderPrimerPopover";

// Slow, breathing halo that cycles through the palette so the Ask AI
// affordance reads as alive without becoming a flashing distraction. Each
// step blends two of the three palette stops over a 6s cycle. One halo per
// ground: light runs the hot ramp (orange / pink / violet), dark the langy
// ramp (blue / purple / amber).
const createAiGlowPulse = (palette: readonly string[]) => keyframes`
  0%, 100% {
    box-shadow:
      0 0 0 0 ${palette[0]}33,
      0 1px 4px ${palette[2]}55;
  }
  50% {
    box-shadow:
      0 0 14px 2px ${palette[1]}66,
      0 1px 4px ${palette[2]}55;
  }
`;
const aiGlowPulseHot = createAiGlowPulse(aiBrandPaletteHot);
const aiGlowPulse = createAiGlowPulse(aiBrandPalette);

interface AskAiButtonProps {
  onClick: () => void;
  /** Tooltip copy. Defaults match the search bar's "tell us what you want…". */
  tooltip?: string;
  /** aria-label override. */
  ariaLabel?: string;
  /** Show the label text alongside the icon. Defaults to true. */
  showLabel?: boolean;
  /**
   * Button label. Defaults to "Ask AI"; the search bar passes "Ask Langy"
   * when Langy owns the affordance and the click opens the panel instead of
   * the inline composer.
   */
  label?: string;
  /**
   * When true, the click handler is replaced with a primer popover that
   * explains the user needs to configure a model provider first. Used
   * when no provider is enabled — the affordance still reads as gated,
   * not entirely missing, so the feature stays discoverable.
   */
  needsProviderPrimer?: boolean;
  /**
   * When set, the button is fully gated: click is a no-op and the
   * tooltip surfaces this reason instead of the usual "tell us what
   * you want" copy. Used by sample-preview mode — Ask AI hits the
   * real LLM and our sample fixtures don't exist server-side, so a
   * click would either error or invent answers. Keeping the button
   * visible (just dimmed) preserves the affordance so the user
   * knows it'll be available on their real data.
   */
  disabledReason?: string;
  /**
   * Drops the halo while another affordance on the same row is animating,
   * so the search bar never pulses in two places at once. The button stays
   * fully usable; only the animation stands down.
   */
  quiet?: boolean;
}

/**
 * The brand ask affordance — gradient-filled button with the `Sparkles` icon
 * and (optionally) a label, "Ask AI" by default. The search bar uses it to
 * enter the inline AI composer, or — relabelled "Ask Langy" — to hand the
 * search off to the Langy panel. Same visuals either way so the AI surface
 * reads as one consistent feature.
 */
const AskAiButtonImpl: React.FC<AskAiButtonProps> = ({
  onClick,
  tooltip = "Tell us what you want, and let AI make it happen",
  ariaLabel = "Enter AI mode",
  showLabel = true,
  label = "Ask AI",
  needsProviderPrimer = false,
  disabledReason,
  quiet = false,
}) => {
  const reduceMotion = useReducedMotion();
  const isGated = needsProviderPrimer || !!disabledReason;
  // Light keeps the hot ramp (the langy ramp read lifeless on white); dark
  // keeps the langy identity ramp untouched.
  const palette = useColorModeValue(aiBrandPaletteHot, aiBrandPalette);
  const glowPulse = useColorModeValue(aiGlowPulseHot, aiGlowPulse);
  const button = (
    <Button
      aria-label={ariaLabel}
      aria-disabled={disabledReason ? "true" : undefined}
      // Spotlight anchor used by the trace-explorer tour — the search
      // callout points here rather than the whole search bar so the
      // floating popover orbits a small, named target instead of the
      // entire input row. See `TRACE_EXPLORER_SPOTLIGHTS[0]`.
      data-spotlight="ask-ai-chip"
      size="2xs"
      flexShrink={0}
      onClick={isGated ? undefined : onClick}
      color="white"
      fontWeight="600"
      position="relative"
      overflow="hidden"
      bg="transparent"
      boxShadow="0 1px 4px rgba(168,85,247,0.25), 0 0 0 1px rgba(255,95,31,0.12)"
      _dark={{ boxShadow: "0 1px 4px rgba(237,137,38,0.16)" }}
      // Live "AI breathing" halo — only when motion is allowed. Skipped
      // when fully gated by `disabledReason` (sample mode) — a pulsing
      // halo on an inert button reads as broken animation. Provider-
      // primer mode still pulses so the affordance pulls the eye to
      // "set me up to use AI."
      animation={
        reduceMotion || disabledReason || quiet
          ? undefined
          : `${glowPulse} 6s ease-in-out infinite`
      }
      _hover={isGated ? undefined : { filter: "brightness(1.08)" }}
      cursor={disabledReason ? "not-allowed" : undefined}
      // The popover trigger handles activation via aria-expanded — disabling
      // the button would block the popover from opening on click. Instead
      // we lower the visual gain so it reads as gated.
      opacity={isGated ? 0.7 : 1}
      filter={isGated ? "saturate(0.7)" : undefined}
    >
      <Box
        position="absolute"
        inset={0}
        zIndex={0}
        pointerEvents="none"
        _dark={{ opacity: 0.7 }}
      >
        <MeshGradient
          colors={palette}
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
        {showLabel && <Text textStyle="xs">{label}</Text>}
      </HStack>
    </Button>
  );

  if (disabledReason) {
    return (
      <Tooltip content={<Text>{disabledReason}</Text>} openDelay={150}>
        {button}
      </Tooltip>
    );
  }

  if (needsProviderPrimer) {
    return <ProviderPrimerPopover>{button}</ProviderPrimerPopover>;
  }

  return (
    <Tooltip
      content={
        <HStack gap={2}>
          <Text>{tooltip}</Text>
          <Kbd>{"⌘"}</Kbd>
          <Kbd>{"I"}</Kbd>
        </HStack>
      }
      openDelay={200}
    >
      {button}
    </Tooltip>
  );
};

// Memoised so the WebGL `MeshGradient` doesn't re-reconcile on every parent
// re-render (the SearchBar re-renders on every keystroke as the query text
// updates, and the shader is already running its own animation loop).
export const AskAiButton = React.memo(AskAiButtonImpl);
