import { Button, HStack, Icon, Text } from "@chakra-ui/react";
import { LuExternalLink, LuLightbulb } from "react-icons/lu";
import { exactModelMatchRegex } from "~/utils/modelCostRegex";

/**
 * Deep link to the model costs settings page (project context comes from
 * the session, not the path) with the cost drawer already open and
 * prefilled, `drawer.*` params are how `CurrentDrawer` hydrates drawer
 * props from the URL.
 */
export function modelCostMappingUrl(model: string): string {
  const params = new URLSearchParams({
    "drawer.open": "llmModelCost",
    "drawer.prefillModel": model,
    "drawer.prefillRegex": exactModelMatchRegex(model),
  });
  return `/settings/model-costs?${params.toString()}`;
}

/**
 * Shown in the span detail pane when the span carries a model and token
 * usage but nothing priced it (`spanDetail.costSuggestion`). One click opens
 * the model costs page in a new window with the drawer prefilled for this
 * exact model, regex auto-generated.
 */
export function UnmappedCostSuggestion({ model }: { model: string }) {
  return (
    <HStack
      gap={2}
      marginX={4}
      marginTop={3}
      paddingX={3}
      paddingY={2}
      borderRadius="sm"
      bg="blue.subtle"
      align="center"
      data-testid="unmapped-cost-suggestion"
    >
      <Icon as={LuLightbulb} boxSize={4} color="blue.fg" flexShrink={0} />
      <Text textStyle="xs" color="blue.fg" flex={1} minWidth={0}>
        This span has token counts but no cost mapped for{" "}
        <Text as="span" fontFamily="mono" fontWeight="semibold">
          {model}
        </Text>
        .
      </Text>
      <Button
        size="2xs"
        variant="outline"
        colorPalette="blue"
        flexShrink={0}
        onClick={() =>
          window.open(
            modelCostMappingUrl(model),
            "_blank",
            "noopener,noreferrer",
          )
        }
      >
        Add cost mapping
        <Icon as={LuExternalLink} boxSize={3} />
      </Button>
    </HStack>
  );
}
