/**
 * In-picker empty state for any model selection surface when the
 * project has no enabled model providers (or no models of the right
 * mode — chat vs embedding).
 *
 * Replaces the prior behaviour where ModelSelector rendered the bogus
 * system fallback string (e.g. "openai/gpt-5.2") in gray, which looked
 * like a real selection but errored at runtime. This callout is the
 * honest "you haven't configured anything yet, here's where to go"
 * affordance.
 *
 * Visual style mirrors the traces-v2 details drawer chrome: subtle
 * border + bg.subtle fill + small icon + a single CTA button that
 * deep-links to the model-providers settings page in a new tab so the
 * user doesn't lose the surface they were on. Returning focus to the
 * tab triggers a tRPC focus refetch and the picker comes back to life
 * with the freshly configured providers.
 *
 * See specs/model-providers/no-models-empty-state.feature for the
 * behavioural contract.
 */
import { Box, Button, HStack, Text } from "@chakra-ui/react";
import { Settings2 } from "lucide-react";
import { useOrganizationTeamProject } from "../hooks/useOrganizationTeamProject";
import { Link } from "./ui/link";

interface Props {
  size?: "sm" | "md" | "full";
  /** Caller-provided label so the message says e.g. "for AI search"
   *  when that's the surface, "for evaluators" when it isn't, etc. */
  forFeatureLabel?: string;
  /** Hide the icon for surfaces where there's already a label or icon
   *  immediately above (LLM config popover uses this). */
  iconHidden?: boolean;
}

export function NoModelsConfiguredCallout({
  size = "md",
  forFeatureLabel,
  iconHidden = false,
}: Props) {
  const { project } = useOrganizationTeamProject();
  const settingsHref = project
    ? `/${project.slug}/settings/model-providers`
    : "/settings/model-providers";

  const fontSize = size === "sm" ? "xs" : "sm";

  return (
    <Box
      width={size === "full" ? "100%" : "auto"}
      borderWidth="1px"
      borderColor="border"
      borderRadius="md"
      bg="bg.subtle"
      paddingX={3}
      paddingY={size === "sm" ? 2 : 3}
      data-testid="no-models-configured-callout"
    >
      <HStack gap={3} align="center" justify="space-between" wrap="wrap">
        <HStack gap={2} align="center" flex="1" minWidth={0}>
          {!iconHidden && (
            <Settings2
              size={size === "sm" ? 14 : 16}
              color="var(--chakra-colors-fg-muted)"
              aria-hidden
            />
          )}
          <Text fontSize={fontSize} color="fg.muted" lineClamp={2}>
            No models configured
            {forFeatureLabel ? ` for ${forFeatureLabel}` : ""}.
          </Text>
        </HStack>
        <Button
          size={size === "sm" ? "xs" : "sm"}
          variant="outline"
          asChild
          data-testid="no-models-configured-cta"
        >
          <Link
            href={settingsHref}
            isExternal
            _hover={{ textDecoration: "none" }}
          >
            Set up models
          </Link>
        </Button>
      </HStack>
    </Box>
  );
}
