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
 * Two layouts driven by the `size` prop:
 *   - "sm" / "full" (the inline replacement for a popover trigger):
 *     single row, icon + title + outline CTA. Compact enough to fit
 *     the slot a model chip used to occupy in prompt drawer / workflow
 *     LLM node / evaluator headers.
 *   - "md" (the standalone usage, e.g. an empty-state card in a form):
 *     two rows, with a helper line under the title explaining the
 *     consequence.
 *
 * The CTA is an external link to /settings/model-providers — opens in
 * a new tab so the user doesn't lose the surface they were on. tRPC's
 * focus refetch picks up freshly configured providers when the user
 * returns to this tab.
 *
 * See specs/model-providers/no-models-empty-state.feature.
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

  // Compact layout: single row (icon + title + button). Used when
  // we're replacing a popover trigger that lived in a narrow slot.
  // The `md` variant gets the helper line; it's reserved for the
  // standalone use case where the callout sits on its own row in a
  // form.
  const compact = size !== "md";
  const featureSuffix = forFeatureLabel ? ` for ${forFeatureLabel}` : "";

  return (
    <Box
      width={size === "full" ? "100%" : "auto"}
      borderWidth="1px"
      borderColor="border"
      borderRadius="md"
      bg="bg.subtle"
      paddingX={3}
      paddingY={2}
      data-testid="no-models-configured-callout"
    >
      <HStack
        gap={2}
        align="center"
        justify="space-between"
        wrap="nowrap"
      >
        <HStack gap={2} align="center" flex="1" minWidth={0}>
          <Box color="fg.muted" flexShrink={0} aria-hidden>
            <Settings2 size={14} />
          </Box>
          <VStack align="start" gap={0} flex="1" minWidth={0}>
            <Text
              fontSize="xs"
              fontWeight="medium"
              lineClamp={1}
              data-testid="no-models-configured-title"
            >
              No models configured{featureSuffix}
            </Text>
            {!compact && (
              <Text fontSize="xs" color="fg.muted" lineClamp={2}>
                Pick a provider and add a key.
              </Text>
            )}
          </VStack>
        </HStack>
        <Button
          size="xs"
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
              <Text>Set up</Text>
              <ArrowUpRight size={12} aria-hidden />
            </HStack>
          </Link>
        </Button>
      </HStack>
    </Box>
  );
}
