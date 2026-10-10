import { Alert, Button, Icon, Text } from "@langwatch/design-system/primitives";
import { LuExternalLink } from "react-icons/lu";

import { exactModelMatchRegex } from "../../../../../model/model-cost-regex.ts";

/**
 * Deep link to the model costs settings page (project context comes from
 * the session, not the path) with the cost drawer already open and
 * prefilled, `drawer.*` params are how `CurrentDrawer` hydrates drawer
 * props from the URL.
 */
function modelCostMappingUrl(model: string): string {
  const params = new URLSearchParams({
    "drawer.open": "llmModelCost",
    "drawer.prefillModel": model,
    "drawer.prefillRegex": exactModelMatchRegex(model),
  });
  return `/settings/model-costs?${params.toString()}`;
}

/**
 * Shown at the top of the Attributes section of the span detail pane when
 * the span carries a model and token usage but nothing priced it
 * (`spanDetail.costSuggestion`). One click opens the model costs page in a
 * new window with the drawer prefilled for this exact model, regex
 * auto-generated.
 */
export function UnmappedCostSuggestion({ model }: { model: string }) {
  return (
    <Alert.Root
      status="info"
      size="sm"
      marginBottom={2}
      alignItems="center"
      data-testid="unmapped-cost-suggestion"
    >
      <Alert.Indicator />
      <Alert.Content>
        <Alert.Description>
          This span has token counts but no cost mapped for{" "}
          <Text as="span" fontFamily="mono" fontWeight="semibold">
            {model}
          </Text>
          .
        </Alert.Description>
      </Alert.Content>
      <Button
        size="2xs"
        variant="outline"
        colorPalette="blue"
        flexShrink={0}
        onClick={() => window.open(modelCostMappingUrl(model), "_blank", "noopener,noreferrer")}
      >
        Add cost mapping
        <Icon as={LuExternalLink} boxSize={3} />
      </Button>
    </Alert.Root>
  );
}
