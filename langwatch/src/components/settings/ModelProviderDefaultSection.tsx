import {
  VStack,
  Text,
  Box,
  Field,
} from "@chakra-ui/react";
import type {
  UseModelProviderFormState,
  UseModelProviderFormActions,
} from "../../hooks/useModelProviderForm";
import type { MaybeStoredModelProvider } from "../../server/modelProviders/registry";
import { modelProviders } from "../../server/modelProviders/registry";
import {
  DEFAULT_EMBEDDINGS_MODEL,
  DEFAULT_MODEL,
  DEFAULT_TOPIC_CLUSTERING_MODEL,
} from "../../utils/constants";
import { SmallLabel } from "../SmallLabel";
import { Switch } from "../ui/switch";
import { modelSelectorOptions } from "../ModelSelector";
import { Tooltip } from "../ui/tooltip";
import { isProviderEffectiveDefault } from "../../utils/modelProviderHelpers";
import { ProviderModelSelector } from "./ProviderModelSelector";

/**
 * Renders the "Use as default provider" toggle and default model selection fields.
 * When enabled, allows selection of default models for chat, topic clustering, and embeddings.
 * The toggle is disabled if the provider is currently in use or is the only enabled provider.
 * @param state - Form state containing default provider configuration and model selections
 * @param actions - Form actions for updating default provider settings
 * @param provider - The model provider configuration
 * @param enabledProvidersCount - Total number of currently enabled providers
 * @param project - Current project with default model settings
 */
export const DefaultProviderSection = ({
  state,
  actions,
  provider,
  enabledProvidersCount,
  project,
  providers,
}: {
  state: UseModelProviderFormState;
  actions: UseModelProviderFormActions;
  provider: MaybeStoredModelProvider;
  enabledProvidersCount: number;
  project: {
    defaultModel?: string | null;
    topicClusteringModel?: string | null;
    embeddingsModel?: string | null;
  } | null | undefined;
  providers: Record<string, MaybeStoredModelProvider> | undefined;
}) => {
  // Determine if toggle should be disabled
  // Uses effective defaults (project values with fallbacks to constants)
  const isUsedForDefaults = isProviderEffectiveDefault(provider.provider, project);
  const isOnlyEnabledProvider = enabledProvidersCount === 1;
  const isToggleDisabled = isUsedForDefaults || isOnlyEnabledProvider;

  // Generate tooltip message
  let tooltipMessage = "";
  if (isUsedForDefaults) {
    tooltipMessage =
      "This provider is currently being used for one or more default models and cannot be disabled from default usage.";
  } else if (isOnlyEnabledProvider) {
    tooltipMessage =
      "This is the only enabled provider and must be used as the default.";
  }

  // Get provider name for display
  const providerName = modelProviders[provider.provider as keyof typeof modelProviders]?.name || provider.provider;

  // Get all models from modelSelectorOptions for this specific provider only
  const chatOptions = modelSelectorOptions
    .filter(
      (option) =>
        option.mode === "chat" &&
        option.value.startsWith(`${provider.provider}/`)
    )
    .map((option) => option.value);
  
  const embeddingOptions = modelSelectorOptions
    .filter((option) => {
      if (option.mode !== "embedding") return false;
      const providerKey = option.value.split("/")[0];
      return providers?.[providerKey ?? ""]?.enabled === true;
    })
    .map((option) => option.value);

  return (
    <VStack width="full" align="start" gap={4} paddingTop={4}>
      <Tooltip
        content={tooltipMessage}
        disabled={!isToggleDisabled}
        positioning={{ placement: "top", gutter: 8 }}
      >
        <Box width="fit-content">
          <Switch
            onCheckedChange={(details) => {
              actions.setUseAsDefaultProvider(details.checked);
              
              // When toggling ON, sync the model states to this provider's models
              // if the current state values don't belong to this provider
              // Only set if there are options available, otherwise allow custom input
              if (details.checked) {
                if (!state.projectDefaultModel?.startsWith(`${provider.provider}/`) && chatOptions.length > 0) {
                  const defaultModel = DEFAULT_MODEL.startsWith(`${provider.provider}/`) ? DEFAULT_MODEL : chatOptions[0];
                  actions.setProjectDefaultModel(defaultModel ?? null);
                }
                if (!state.projectTopicClusteringModel?.startsWith(`${provider.provider}/`) && chatOptions.length > 0) {
                  const defaultModel = DEFAULT_TOPIC_CLUSTERING_MODEL.startsWith(`${provider.provider}/`) ? DEFAULT_TOPIC_CLUSTERING_MODEL : chatOptions[0];
                  actions.setProjectTopicClusteringModel(defaultModel ?? null);
                }
                if (!embeddingOptions.includes(state.projectEmbeddingsModel ?? "") && embeddingOptions.length > 0) {
                  const defaultModel = embeddingOptions.includes(DEFAULT_EMBEDDINGS_MODEL) ? DEFAULT_EMBEDDINGS_MODEL : embeddingOptions[0];
                  actions.setProjectEmbeddingsModel(defaultModel ?? null);
                }
              }
            }}
            checked={state.useAsDefaultProvider}
            disabled={isToggleDisabled}
          >
            Use {providerName} as the default for LangWatch features
          </Switch>
        </Box>
      </Tooltip>
      {state.useAsDefaultProvider && (
        <Text fontSize="xs" color="gray.500" marginTop={-2}>
          Configure the default models used for workflows, evaluations and other
          LangWatch features.
        </Text>
      )}

      {/* Default Models Selection - Only visible when toggle is enabled */}
      {state.useAsDefaultProvider && (
        <VStack
          width="full"
          align="start"
          gap={4}
        >
          <Field.Root width="full">
            <SmallLabel>Default Model</SmallLabel>
            <Text fontSize="xs" color="gray.500" marginBottom={2}>
              For general tasks within LangWatch
            </Text>
            <ProviderModelSelector
              model={
                state.projectDefaultModel?.startsWith(`${provider.provider}/`)
                  ? state.projectDefaultModel
                  : (chatOptions[0] ?? "")
              }
              options={chatOptions}
              onChange={(model) => actions.setProjectDefaultModel(model)}
            />
          </Field.Root>

          <Field.Root width="full">
            <SmallLabel>Topic Clustering Model</SmallLabel>
            <Text fontSize="xs" color="gray.500" marginBottom={2}>
              For generating topic names
            </Text>
            <ProviderModelSelector
              model={
                state.projectTopicClusteringModel?.startsWith(`${provider.provider}/`)
                  ? state.projectTopicClusteringModel
                  : (chatOptions[0] ?? "")
              }
              options={chatOptions}
              onChange={(model) =>
                actions.setProjectTopicClusteringModel(model)
              }
            />
          </Field.Root>

          <Field.Root width="full">
            <SmallLabel>Embeddings Model</SmallLabel>
            <Text fontSize="xs" color="gray.500" marginBottom={2}>
              For embeddings to be used in topic clustering and evaluations
            </Text>
            <ProviderModelSelector
              model={state.projectEmbeddingsModel ?? embeddingOptions[0] ?? ""}
              options={embeddingOptions}
              onChange={(model) => actions.setProjectEmbeddingsModel(model)}
            />
          </Field.Root>
        </VStack>
      )}
    </VStack>
  );
};
