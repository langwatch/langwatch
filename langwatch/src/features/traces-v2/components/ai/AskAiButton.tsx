import { Box, Button, HStack, Text, VStack } from "@chakra-ui/react";
import { MeshGradient } from "@paper-design/shaders-react";
import { Sparkles, Zap } from "lucide-react";
import NextLink from "~/utils/compat/next-link";
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
import { aiBrandPalette } from "./aiBrandPalette";

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
}) => {
  const reduceMotion = useReducedMotion();
  const button = (
    <Button
      aria-label={ariaLabel}
      size="2xs"
      flexShrink={0}
      onClick={needsProviderPrimer ? undefined : onClick}
      color="white"
      fontWeight="600"
      position="relative"
      overflow="hidden"
      bg="transparent"
      boxShadow="0 1px 4px rgba(168,85,247,0.25), 0 0 0 1px rgba(255,95,31,0.12)"
      _dark={{ boxShadow: "0 1px 4px rgba(168,85,247,0.18)" }}
      _hover={{ filter: "brightness(1.08)" }}
      // The popover trigger handles activation via aria-expanded — disabling
      // the button would block the popover from opening on click. Instead
      // we lower the visual gain so it reads as gated.
      opacity={needsProviderPrimer ? 0.7 : 1}
      filter={needsProviderPrimer ? "saturate(0.7)" : undefined}
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
              service-x&rdquo;, &ldquo;slow checkout traces with eval
              scores under 0.5&rdquo;. Add a provider to unlock it.
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
