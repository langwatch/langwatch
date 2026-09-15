import { Link, Text } from "@chakra-ui/react";

/**
 * Caption shown next to a scenario Generate button: which model generation will use,
 * with a link to change it in the model provider settings.
 */
export function ResolvedModelCaption({ model }: { model: string | null | undefined }) {
  if (!model) return null;

  return (
    <Text fontSize="xs" color="fg.muted" data-testid="scenario-ai-model-caption">
      Uses{" "}
      <Text as="span" fontWeight="medium">
        {model}
      </Text>{" "}
      ·{" "}
      <Link
        href="/settings/model-providers"
        target="_blank"
        rel="noopener noreferrer"
        color="blue.500"
        fontWeight="medium"
      >
        Change
      </Link>
    </Text>
  );
}
