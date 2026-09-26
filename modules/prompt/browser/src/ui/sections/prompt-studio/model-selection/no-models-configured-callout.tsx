/**
 * In-picker empty state for no enabled providers (or none of the right
 * mode) - the honest "not configured yet" state, replacing a fallback
 * that rendered a bogus model string.
 * @see specs/model-providers/no-models-empty-state.feature
 */
import { Box, Button, chakra, HStack, Text } from "@chakra-ui/react";
import { ArrowUpRight } from "lucide-react";

import { modelProviderIcons } from "./model-provider-icons.tsx";

interface Props {
  size?: "sm" | "md" | "full";
  /** Caller-provided label so the message says "for AI search" when
   *  that's the surface, "for evaluators" when it isn't, etc. */
  forFeatureLabel?: string;
}

/** Provider icons shown stacked in the callout - picks the three most
 *  common chat providers so the row obviously reads as 'model picker'.
 *  Order matters: front icon shows fully, the others peek out behind. */
const STACKED_PROVIDERS = ["openai", "anthropic", "gemini"] as const;

const SETTINGS_HREF = "/settings/model-providers";

export function NoModelsConfiguredCallout({ size = "md", forFeatureLabel }: Props) {
  const featureSuffix = forFeatureLabel ? ` for ${forFeatureLabel}` : "";

  return (
    <chakra.a
      // Whole row is the link; `display="block"` and no underline keep the
      // app's global anchor styles off the rounded border (#4073 round 4).
      href={SETTINGS_HREF}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={`Set up models${featureSuffix}, opens settings in a new tab`}
      display="block"
      textDecoration="none"
      width={size === "full" ? "100%" : "auto"}
      borderWidth="1px"
      borderColor="border"
      borderRadius="md"
      bg="bg"
      paddingX={3}
      paddingY={2}
      cursor="pointer"
      transition="background 0.15s, border-color 0.15s"
      _hover={{ bg: "bg.subtle", borderColor: "border.emphasized", textDecoration: "none" }}
      _focusVisible={{
        outline: "2px solid",
        outlineColor: "border.emphasized",
        outlineOffset: "2px",
      }}
      data-testid="no-models-configured-callout"
    >
      <HStack gap={2} align="center" justify="space-between" wrap="nowrap">
        <HStack gap={2} align="center" flex="1" minWidth={0}>
          <StackedProviderIcons />
          <Text
            fontSize="xs"
            fontWeight="medium"
            opacity={0.8}
            lineClamp={1}
            data-testid="no-models-configured-title"
          >
            No models configured{featureSuffix}
          </Text>
        </HStack>
        <Button
          as="span"
          size="xs"
          variant="subtle"
          colorPalette="gray"
          data-testid="no-models-configured-cta"
          flexShrink={0}
          // Visual hover only - the wrapper handles the actual nav.
          _hover={{ bg: "gray.200" }}
          pointerEvents="none"
        >
          <HStack gap={1}>
            <Text>Set up</Text>
            <ArrowUpRight size={12} aria-hidden />
          </HStack>
        </Button>
      </HStack>
    </chakra.a>
  );
}

/**
 * Three provider logos overlapping by ~8px, from the shared icon registry
 * (one map to change). Sized 20px - between the dropdown's 24px chips and a
 * plain icon - so colored brand marks read as "these are providers" alone.
 */
function StackedProviderIcons() {
  return (
    <HStack gap={0} flexShrink={0} aria-hidden>
      {STACKED_PROVIDERS.map((key, idx) => (
        <Box
          key={key}
          width="20px"
          height="20px"
          marginLeft={idx === 0 ? 0 : "-8px"}
          borderRadius="full"
          bg="bg"
          borderWidth="1px"
          borderColor="border"
          display="inline-flex"
          alignItems="center"
          justifyContent="center"
          // Stack later icons behind earlier ones so the first stays
          // fully visible. Inverted z so left-most icon is on top.
          zIndex={STACKED_PROVIDERS.length - idx}
          overflow="hidden"
        >
          <Box width="14px" height="14px">
            {modelProviderIcons[key as keyof typeof modelProviderIcons]}
          </Box>
        </Box>
      ))}
    </HStack>
  );
}
