/**
 * In-picker empty state for any model selection surface when the
 * project has no enabled model providers (or no models of the right
 * mode — chat vs embedding).
 *
 * Replaces the prior behaviour where ModelSelector rendered the bogus
 * system fallback string (e.g. "openai/gpt-5.2") in gray inside the
 * trigger. That looked like a real selection but every AI call errored
 * at runtime. This callout is the honest "you haven't configured
 * anything yet, here's where to go" affordance.
 *
 * v4 visual contract (rchaves feedback round 2):
 *   - Stacked OpenAI / Anthropic / Gemini provider icons (not a
 *     Settings gear) so the surface reads as 'about models' at a
 *     glance. Icons overlap each other by a few px to hint at a
 *     'choose from these' affordance.
 *   - White background so the row matches the regular model-picker
 *     chip styling instead of the gray bg.subtle of the prior cut.
 *   - 'No models configured' text at 0.8 opacity for a disabled-look
 *     hint that the surface is non-functional until set up.
 *   - 'Set up' button keeps a subtle gray fill (variant='subtle') so
 *     it reads as a real action without competing with primary CTAs.
 *   - The entire row is clickable (the button is a visual focal point
 *     but the click target is the whole component). Opens
 *     /settings/model-providers in a new tab. tRPC focus refetch
 *     picks up freshly configured providers on tab-return.
 *
 * See specs/model-providers/no-models-empty-state.feature.
 */
import { Box, Button, HStack, Text } from "@chakra-ui/react";
import { ArrowUpRight } from "lucide-react";
import { modelProviderIcons } from "../server/modelProviders/iconsMap";

interface Props {
  size?: "sm" | "md" | "full";
  /** Caller-provided label so the message says "for AI search" when
   *  that's the surface, "for evaluators" when it isn't, etc. */
  forFeatureLabel?: string;
}

/** Provider icons shown stacked in the callout — picks the three most
 *  common chat providers so the row obviously reads as 'model picker'.
 *  Order matters: front icon shows fully, the others peek out behind. */
const STACKED_PROVIDERS = ["openai", "anthropic", "gemini"] as const;

const SETTINGS_HREF = "/settings/model-providers";

export function NoModelsConfiguredCallout({
  size = "md",
  forFeatureLabel,
}: Props) {
  const featureSuffix = forFeatureLabel ? ` for ${forFeatureLabel}` : "";

  // Whole-row click navigates to settings in a new tab. The inner button
  // still gets its own hover treatment for visual feedback, but it is
  // not an anchor (nested anchors are invalid HTML); the wrapper Box
  // owns the navigation.
  const openSettings = () => {
    window.open(SETTINGS_HREF, "_blank", "noopener,noreferrer");
  };

  return (
    <Box
      // Whole row is clickable. Rendered as a div (not an <a>) because
      // Chakra's global anchor styles in this app fragment the rounded
      // border (showed up as detached corner brackets — #4073 round 4).
      // a11y is preserved via role=link + tabIndex + keyboard handler.
      role="link"
      tabIndex={0}
      aria-label={`Set up models${featureSuffix}, opens settings in a new tab`}
      onClick={openSettings}
      onKeyDown={(e: React.KeyboardEvent) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          openSettings();
        }
      }}
      width={size === "full" ? "100%" : "auto"}
      borderWidth="1px"
      borderColor="border"
      borderRadius="md"
      bg="bg"
      paddingX={3}
      paddingY={2}
      cursor="pointer"
      transition="background 0.15s, border-color 0.15s"
      _hover={{ bg: "bg.subtle", borderColor: "border.emphasized" }}
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
          // Visual hover only — the wrapper handles the actual nav.
          _hover={{ bg: "gray.200" }}
          pointerEvents="none"
        >
          <HStack gap={1}>
            <Text>Set up</Text>
            <ArrowUpRight size={12} aria-hidden />
          </HStack>
        </Button>
      </HStack>
    </Box>
  );
}

/** Three provider logos stacked with negative left-margins so each
 *  one overlaps the next by ~8px. Icons come from the shared registry
 *  so adding/removing a provider only changes one map.
 *
 *  Sized 20px so the row reads as 'these are providers' from a
 *  glance — smaller than the dropdown's 24px chips but larger than a
 *  lucide icon, and the colored brand marks make the row obviously
 *  about model selection without a label. */
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
