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
 * Visual hierarchy is tuned for the LLMConfigField slot in prompt /
 * workflow / evaluator drawers:
 *   row 1: small Settings icon · bold "No models configured" title
 *   row 2: muted helper line explaining the consequence
 *   row 3-aligned: outline "Set up models →" button that opens
 *     /settings/model-providers in a new tab so the user doesn't lose
 *     the surface they were on. tRPC's focus refetch picks up freshly
 *     configured providers when the user returns to this tab.
 *
 * The smaller variants (size="sm") collapse the helper line — keeps
 * the row height compatible with inline dropdown triggers in places
 * like the optimization studio's LLM node properties panel.
 *
 * See specs/model-providers/no-models-empty-state.feature for the
 * behavioural contract.
 */
import { Box, Button, HStack, Text, VStack } from "@chakra-ui/react";
import { ArrowUpRight, Settings2 } from "lucide-react";
import { useOrganizationTeamProject } from "../hooks/useOrganizationTeamProject";
import { Link } from "./ui/link";

interface Props {
  size?: "sm" | "md" | "full";
  /** Caller-provided label so the message says "for AI search" when
   *  that's the surface, "for evaluators" when it isn't, etc. */
  forFeatureLabel?: string;
}

export function NoModelsConfiguredCallout({
  size = "md",
  forFeatureLabel,
}: Props) {
  const { project } = useOrganizationTeamProject();
  const settingsHref = project
    ? `/${project.slug}/settings/model-providers`
    : "/settings/model-providers";

  const compact = size === "sm";
  const titleSize = compact ? "xs" : "sm";
  const bodySize = compact ? "xs" : "sm";
  const iconSize = compact ? 14 : 16;
  const featureSuffix = forFeatureLabel ? ` for ${forFeatureLabel}` : "";

  return (
    <Box
      width={size === "full" ? "100%" : "auto"}
      borderWidth="1px"
      borderColor="border"
      borderRadius="md"
      bg="bg.subtle"
      paddingX={compact ? 3 : 4}
      paddingY={compact ? 2 : 3}
      data-testid="no-models-configured-callout"
    >
      <HStack
        gap={compact ? 2 : 3}
        align={compact ? "center" : "start"}
        justify="space-between"
      >
        <HStack gap={compact ? 2 : 3} align="start" flex="1" minWidth={0}>
          <Box
            marginTop={compact ? 0 : "2px"}
            color="fg.muted"
            flexShrink={0}
            aria-hidden
          >
            <Settings2 size={iconSize} />
          </Box>
          <VStack align="start" gap={compact ? 0 : 1} flex="1" minWidth={0}>
            <Text fontSize={titleSize} fontWeight="medium" lineClamp={1}>
              No models configured{featureSuffix}
            </Text>
            {!compact && (
              <Text fontSize={bodySize} color="fg.muted" lineClamp={2}>
                Pick a provider and add a key so this surface has
                something to call.
              </Text>
            )}
          </VStack>
        </HStack>
        <Button
          size={compact ? "xs" : "sm"}
          variant="outline"
          asChild
          data-testid="no-models-configured-cta"
          flexShrink={0}
        >
          <Link
            href={settingsHref}
            isExternal
            _hover={{ textDecoration: "none" }}
          >
            <HStack gap={1}>
              <Text>Set up models</Text>
              <ArrowUpRight size={compact ? 12 : 14} aria-hidden />
            </HStack>
          </Link>
        </Button>
      </HStack>
    </Box>
  );
}
