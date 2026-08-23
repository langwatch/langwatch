import {
  Box,
  Code,
  Field,
  HStack,
  Input,
  NativeSelect,
  Text,
  VStack,
} from "@chakra-ui/react";
import { type Control, useWatch } from "react-hook-form";

import { FieldInfoTooltip } from "~/components/ui/FieldInfoTooltip";
import { api } from "~/utils/api";
import {
  MODEL_TIER_PRESETS,
  MODEL_TIERS,
  type ModelTier,
  modelTierRequestSnippet,
} from "~/utils/modelTierPresets";

import type { RoutingPolicyFormValues } from "./routingPolicyForm";

/**
 * The tier editor: one row per reserved name, plus the model every unanswered
 * tier falls back to.
 *
 * A tier is what a client sends instead of naming a model, so this section is
 * the one place in the product where an operator decides what "the most
 * capable model" means for their organization. The request snippet sits next
 * to it so the payoff is visible while choosing.
 */
export function ModelTiersSection({
  control,
  organizationId,
  boundProviderTypes,
  onTierChange,
  onDefaultModelChange,
}: {
  control: Control<RoutingPolicyFormValues>;
  organizationId: string;
  boundProviderTypes: string[];
  onTierChange: (tier: ModelTier, modelId: string) => void;
  onDefaultModelChange: (modelId: string) => void;
}) {
  const tiers = useWatch({ control, name: "tiers" });
  const defaultModel = useWatch({ control, name: "defaultModel" });

  return (
    <VStack align="stretch" gap={3}>
      <HStack>
        <Text fontSize="sm" fontWeight="semibold">
          Model tiers
        </Text>
        <FieldInfoTooltip
          description="Reserved model names a client can send instead of naming a specific model. Point each one at the model your organization wants it to mean, and a client written once keeps working when you move to a newer model."
          docHref="/ai-gateway/model-aliases"
        />
      </HStack>

      <VStack align="stretch" gap={3}>
        {MODEL_TIER_PRESETS.map((preset) => (
          <TierRow
            key={preset.tier}
            tier={preset.tier}
            label={preset.label}
            description={preset.description}
            value={tiers[preset.tier]}
            fallbackModel={defaultModel}
            organizationId={organizationId}
            boundProviderTypes={boundProviderTypes}
            onChange={(modelId) => onTierChange(preset.tier, modelId)}
          />
        ))}
      </VStack>

      <Field.Root>
        <Field.Label>Default model</Field.Label>
        <Input
          size="sm"
          value={defaultModel}
          placeholder="openai/gpt-5-mini"
          onChange={(event) => onDefaultModelChange(event.target.value)}
        />
        <Field.HelperText>
          Answers any tier above you have not pointed somewhere specific. It
          applies to the tier names only, so a model name a client gets wrong is
          still rejected rather than quietly served.
        </Field.HelperText>
      </Field.Root>

      <Box
        borderWidth="1px"
        borderColor="border.muted"
        borderRadius="md"
        backgroundColor="bg.subtle"
        padding={3}
      >
        <VStack align="start" gap={1}>
          <Text fontSize="xs" fontWeight="semibold">
            What a client sends
          </Text>
          <Code fontSize="xs" whiteSpace="pre" padding={2} width="full">
            {modelTierRequestSnippet(MODEL_TIERS[0])}
          </Code>
        </VStack>
      </Box>
    </VStack>
  );
}

function TierRow({
  tier,
  label,
  description,
  value,
  fallbackModel,
  organizationId,
  boundProviderTypes,
  onChange,
}: {
  tier: ModelTier;
  label: string;
  description: string;
  value: string;
  fallbackModel: string;
  organizationId: string;
  boundProviderTypes: string[];
  onChange: (modelId: string) => void;
}) {
  const suggestions = api.routingPolicy.tierSuggestions.useQuery(
    { organizationId, tier, boundProviderTypes },
    { enabled: !!organizationId, refetchOnWindowFocus: false },
  );

  const options = suggestions.data ?? [];
  const isKnownOption = options.some((option) => option.modelId === value);

  return (
    <Box
      borderWidth="1px"
      borderColor="border.muted"
      borderRadius="md"
      padding={3}
    >
      <VStack align="stretch" gap={2}>
        <HStack gap={2} alignItems="baseline" flexWrap="wrap">
          <Code fontSize="xs">{tier}</Code>
          <Text fontSize="sm" fontWeight="medium">
            {label}
          </Text>
        </HStack>
        <Text fontSize="xs" color="fg.muted">
          {description}
        </Text>
        <NativeSelect.Root size="sm">
          <NativeSelect.Field
            aria-label={`Model for the ${tier} tier`}
            value={isKnownOption ? value : ""}
            onChange={(event) => onChange(event.target.value)}
          >
            <option value="">
              {fallbackModel
                ? `Use the default model (${fallbackModel})`
                : "No model yet"}
            </option>
            {options.map((option) => (
              <option key={option.modelId} value={option.modelId}>
                {option.name}
                {option.recommended ? " (recommended)" : ""}
              </option>
            ))}
            {value && !isKnownOption && <option value={value}>{value}</option>}
          </NativeSelect.Field>
        </NativeSelect.Root>
        {value && !isKnownOption && (
          <Text fontSize="xs" color="orange.fgMuted">
            This model is not in the catalog. It still routes, but check the
            name.
          </Text>
        )}
      </VStack>
    </Box>
  );
}
