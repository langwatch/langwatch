import { HStack, Text, VStack } from "@chakra-ui/react";
import type React from "react";
import { useMemo } from "react";
import {
  getModelProvider,
  modelProviderRegistry,
} from "~/features/onboarding/regions/model-providers/registry";
import type {
  ModelProviderKey,
  ModelProviderSpec,
  ModelProviderSurface,
} from "~/features/onboarding/regions/model-providers/types";
import { SelectableIconCard } from "../shared/SelectableIconCard";

interface ModelProviderGridProps {
  variant: ModelProviderSurface;
  modelProviderKey: ModelProviderKey;
  onSelectModelProvider: (modelProvider: ModelProviderKey) => void;
}

const variantDescriptions: Record<ModelProviderSurface, string> = {
  evaluations:
    "We'll use this model to run your evaluations, and show you where your interactions shines, and where it doesn't.",
  prompts:
    "We'll use this model when you run evaluations on your datasets, in your traces, or analyze responses after they happen.",
  langy:
    "Langy uses this model to chat with you and help you work across the platform.",
  onboarding:
    "The model LangWatch's AI assistant and AI assists run on. You can add more providers later in Settings.",
};

/**
 * The recommendation line, shown on surfaces where a provider leads with the
 * badge (Codex on Langy setup and onboarding today).
 */
const RECOMMENDED_COPY =
  "Codex is recommended if you have a paid OpenAI account: sign in and it runs on your plan, no API key. Otherwise pick another provider and paste its key.";

/**
 * The providers this surface offers, in the order this surface wants:
 * providers the surface recommends lead (badged), the rest keep registry
 * order, and providers the surface must not offer are gone entirely.
 */
export function providersForSurface(
  variant: ModelProviderSurface,
): ModelProviderSpec[] {
  const offered = modelProviderRegistry.filter(
    (mp) => !mp.hiddenOn?.includes(variant),
  );
  return [
    ...offered.filter((mp) => mp.recommendedOn?.includes(variant)),
    ...offered.filter((mp) => !mp.recommendedOn?.includes(variant)),
  ];
}

export function ModelProviderGrid({
  variant,
  modelProviderKey,
  onSelectModelProvider,
}: ModelProviderGridProps): React.ReactElement | null {
  const modelProvider = getModelProvider(modelProviderKey);
  // The Langy panel already leads with its own "needs a model" heading, and
  // its column is a third the width of an onboarding page: no second heading,
  // and compact cards so the grid doesn't dwarf the panel.
  const isCompact = variant === "langy";
  const providers = useMemo(() => providersForSurface(variant), [variant]);
  const hasRecommended = providers.some((mp) =>
    mp.recommendedOn?.includes(variant),
  );

  return (
    <VStack align="stretch" gap={3}>
      <VStack align="stretch" gap={0}>
        {!isCompact && (
          <Text fontSize="md" fontWeight="semibold">
            Give LangWatch access to{" "}
            {modelProvider?.label ?? "selected model provider"}
          </Text>
        )}
        <Text fontSize="xs" color="fg.muted">
          {variantDescriptions[variant]}
          {hasRecommended ? ` ${RECOMMENDED_COPY}` : null}
        </Text>
      </VStack>
      <HStack gap={isCompact ? 2 : 3} wrap="wrap">
        {providers.map((mp) => (
          <SelectableIconCard
            key={mp.key}
            label={mp.label}
            size={isCompact ? "sm" : "md"}
            iconSize={isCompact ? "lg" : "2xl"}
            icon={mp.icon}
            selected={mp.key === modelProviderKey}
            onClick={() => onSelectModelProvider(mp.key)}
            ariaLabel={mp.label}
            badge={
              mp.recommendedOn?.includes(variant) ? "Recommended" : undefined
            }
          />
        ))}
      </HStack>
    </VStack>
  );
}
