import { Box, Button, HStack, Text, VStack } from "@chakra-ui/react";
import { keyframes } from "@emotion/react";
import { MeshGradient } from "@paper-design/shaders-react";
import { Sparkles, Zap } from "lucide-react";
import React, { useCallback, useState } from "react";
import { Kbd } from "~/components/ops/shared/Kbd";
import {
  PopoverArrow,
  PopoverBody,
  PopoverContent,
  PopoverRoot,
  PopoverTrigger,
} from "~/components/ui/popover";
import { Tooltip } from "~/components/ui/tooltip";
import { useReducedMotion } from "~/hooks/useReducedMotion";
import NextLink from "~/utils/compat/next-link";
import { aiBrandPalette } from "./aiBrandPalette";

// Slow, breathing halo that cycles through the brand palette so the
// Ask AI affordance reads as alive without becoming a flashing
// distraction. Each step blends two of the three palette stops so the
// shadow drifts between orange / pink / violet over a 6s cycle.
const aiGlowPulse = keyframes`
  0%, 100% {
    box-shadow:
      0 0 0 0 ${aiBrandPalette[0]}33,
      0 1px 4px ${aiBrandPalette[2]}55;
  }
  50% {
    box-shadow:
      0 0 14px 2px ${aiBrandPalette[1]}66,
      0 1px 4px ${aiBrandPalette[2]}55;
  }
`;

interface AskAiButtonProps {
  onClick: () => void;
  /** Tooltip copy. Defaults match the search bar's "tell us what you want…". */
  tooltip?: string;
  /** aria-label override. */
  ariaLabel?: string;
  /** Show "Ask AI" text alongside the icon. Defaults to true. */
  showLabel?: boolean;
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
}

/**
 * The brand "Ask AI" affordance — gradient-filled button with the
 * `Sparkles` icon and (optionally) the "Ask AI" label. Used in the
 * search bar to enter AI mode and in the lens-creation popover to
 * switch to the AI input. Same visuals everywhere so the AI surface
 * reads as one consistent feature.
 */
const AskAiButtonImpl: React.FC<AskAiButtonProps> = ({
  onClick,
  tooltip = "Tell us what you want, and let AI make it happen",
  ariaLabel = "Enter AI mode",
  showLabel = true,
  needsProviderPrimer = false,
  disabledReason,
}) => {
  const reduceMotion = useReducedMotion();
  const isGated = needsProviderPrimer || !!disabledReason;
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
      _dark={{ boxShadow: "0 1px 4px rgba(168,85,247,0.18)" }}
      // Live "AI breathing" halo — only when motion is allowed. Skipped
      // when fully gated by `disabledReason` (sample mode) — a pulsing
      // halo on an inert button reads as broken animation. Provider-
      // primer mode still pulses so the affordance pulls the eye to
      // "set me up to use AI."
      animation={
        reduceMotion || disabledReason
          ? undefined
          : `${aiGlowPulse} 6s ease-in-out infinite`
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
  );

  if (disabledReason) {
    return (
      <Tooltip content={<Text>{disabledReason}</Text>} openDelay={150}>
        {button}
      </Tooltip>
    );
  }

  if (needsProviderPrimer) {
    return <ProviderPrimerPopover trigger={button} />;
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

interface ProviderPrimerPopoverProps {
  trigger: React.ReactElement;
}

/**
 * Shown in place of the regular AI tooltip when no model provider is
 * enabled. The point isn't just to disable the affordance — it's to
 * teach the user *why* they need a provider and link them straight to
 * the settings page so they can finish setup in one click.
 */
const ProviderPrimerPopover: React.FC<ProviderPrimerPopoverProps> = ({
  trigger,
}) => {
  const [open, setOpen] = useState(false);
  const handleOpenChange = useCallback(
    (e: { open: boolean }) => setOpen(e.open),
    [],
  );

  return (
    <PopoverRoot
      open={open}
      onOpenChange={handleOpenChange}
      positioning={{ placement: "bottom-start" }}
    >
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent maxWidth="320px">
        <PopoverArrow />
        <PopoverBody>
          <VStack align="stretch" gap={3}>
            <HStack gap={2}>
              <Box
                width="28px"
                height="28px"
                borderRadius="full"
                bg="purple.subtle"
                display="flex"
                alignItems="center"
                justifyContent="center"
                color="purple.fg"
              >
                <Zap size={14} />
              </Box>
              <Text textStyle="sm" fontWeight="semibold">
                Connect a model provider
              </Text>
            </HStack>
            <Text textStyle="xs" color="fg.muted" lineHeight="1.5">
              Ask AI uses your own model provider keys to translate plain
              English into trace queries — &ldquo;errors yesterday from
              service-x&rdquo;, &ldquo;slow checkout traces with eval scores
              under 0.5&rdquo;. Add a provider to unlock it.
            </Text>
            <NextLink
              href="/settings/model-providers"
              style={{ display: "block" }}
            >
              <Button
                size="xs"
                width="full"
                bg="purple.solid"
                color="white"
                _hover={{ bg: "purple.fg" }}
              >
                Add a provider
              </Button>
            </NextLink>
          </VStack>
        </PopoverBody>
      </PopoverContent>
    </PopoverRoot>
  );
};

// Memoised so the WebGL `MeshGradient` doesn't re-reconcile on every parent
// re-render (the SearchBar re-renders on every keystroke as the query text
// updates, and the shader is already running its own animation loop).
export const AskAiButton = React.memo(AskAiButtonImpl);
