import {
  Badge,
  Box,
  Button,
  HStack,
  Text,
  VStack,
  Wrap,
} from "@chakra-ui/react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { useState } from "react";
import { modelProviderIcons } from "~/components/modelProviders/iconsMap";
import { Checkbox } from "~/components/ui/checkbox";
import { ProviderScopeChips } from "../settings/ProviderScopeChips";

import type {
  EligibleModelProvider,
  OrgModelProvider,
} from "./eligibleModelProviders";

function providerModels(provider: OrgModelProvider | undefined): string[] {
  if (!provider) return [];
  const registry = provider.models ?? [];
  const custom = (provider.customModels ?? []).map((m) => m.modelId);
  return [...new Set([...registry, ...custom])];
}

/**
 * One provider row of the access section: the checkbox, the origin
 * chips, and the expandable per-model restriction list. Model
 * restrictions are keyed by vendor wire id (`vendor/model`), so two
 * rows of the same vendor render one shared restriction.
 */
export function ProviderRow({
  mp,
  raw,
  allProviders,
  checked,
  onCheck,
  scopeName,
  modelsAllowed,
  onModelsAllowedChange,
  winsProviderTypePrefix,
}: {
  mp: EligibleModelProvider;
  raw: OrgModelProvider | undefined;
  allProviders: boolean;
  checked: boolean;
  onCheck: (checked: boolean) => void;
  scopeName: string | undefined;
  modelsAllowed: string[];
  onModelsAllowedChange: (next: string[]) => void;
  /**
   * Whether a request writing the bare provider type ("anthropic/…") reaches
   * THIS provider. True for the first provider of its type in the key's own
   * order. Only meaningful per key, because the order is the key's.
   */
  winsProviderTypePrefix: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const models = providerModels(raw);
  const prefix = `${mp.provider}/`;
  const pickedForProvider = modelsAllowed.filter((m) => m.startsWith(prefix));
  const pickedSet = new Set(pickedForProvider);

  const toggleModel = (bareModel: string, modelChecked: boolean) => {
    const wireId = `${prefix}${bareModel}`;
    const rest = modelsAllowed.filter((m) => m !== wireId);
    onModelsAllowedChange(modelChecked ? [...rest, wireId] : rest);
  };

  const icon =
    mp.provider in modelProviderIcons
      ? modelProviderIcons[mp.provider as keyof typeof modelProviderIcons]
      : null;

  return (
    <VStack
      align="stretch"
      gap={0}
      borderWidth="1px"
      borderColor="border.subtle"
      borderRadius="md"
    >
      <HStack paddingX={2} paddingY={1.5} gap={2}>
        <Checkbox
          size="sm"
          checked={checked}
          disabled={allProviders}
          onCheckedChange={(d: { checked: unknown }) =>
            onCheck(d.checked === true)
          }
          inputProps={{ "aria-label": mp.label }}
          data-testid={`vk-provider-${mp.id}`}
        />
        <Box
          width="16px"
          height="16px"
          flexShrink={0}
          display="flex"
          alignItems="center"
          justifyContent="center"
          css={{ "& > svg": { width: "100%", height: "100%" } }}
        >
          {icon}
        </Box>
        <VStack align="start" gap={0}>
          <Text fontSize="sm" fontWeight="medium">
            {mp.label}
          </Text>
          <HStack gap={1} color="fg.muted" fontSize="2xs">
            <Text>Reached as</Text>
            {raw?.routingHandle ? (
              <Text
                as="code"
                data-testid={`vk-provider-${mp.id}-handle-spelling`}
              >{`${raw.routingHandle}/<model>`}</Text>
            ) : null}
            <Text
              as="code"
              data-testid={`vk-provider-${mp.id}-type-spelling`}
            >{`${mp.provider}/<model>`}</Text>
            {winsProviderTypePrefix ? (
              <Badge
                size="xs"
                colorPalette="green"
                data-testid={`vk-provider-${mp.id}-first-for-type`}
              >
                first for {mp.provider}
              </Badge>
            ) : null}
          </HStack>
        </VStack>
        <Box flex={1} />
        <ProviderScopeChips
          size="xs"
          scopes={[
            {
              scopeType: mp.definedAt.scopeType,
              scopeId: mp.definedAt.scopeId,
              name: scopeName,
            },
          ]}
        />
        {models.length > 0 && (
          <Button
            type="button"
            variant="ghost"
            size="2xs"
            color="fg.muted"
            onClick={() => setExpanded((e) => !e)}
            aria-expanded={expanded}
            data-testid={`vk-provider-${mp.id}-models-toggle`}
          >
            <HStack gap={0.5}>
              {expanded ? (
                <ChevronDown size={12} aria-hidden />
              ) : (
                <ChevronRight size={12} aria-hidden />
              )}
              <Text fontSize="xs">
                {pickedForProvider.length > 0
                  ? `${pickedForProvider.length} of ${models.length} models`
                  : `${models.length} ${models.length === 1 ? "model" : "models"}`}
              </Text>
            </HStack>
          </Button>
        )}
      </HStack>
      {expanded && models.length > 0 && (
        <Box
          borderTopWidth="1px"
          borderColor="border.subtle"
          paddingX={2}
          paddingY={2}
        >
          <Text fontSize="2xs" color="fg.muted" marginBottom={1.5}>
            {pickedForProvider.length === 0
              ? "All models allowed. Check models to restrict."
              : "Only the checked models are allowed."}
          </Text>
          <Wrap gap={2}>
            {models.map((model) => (
              <Checkbox
                key={model}
                size="sm"
                checked={pickedSet.has(`${prefix}${model}`)}
                onCheckedChange={(d: { checked: unknown }) =>
                  toggleModel(model, d.checked === true)
                }
                inputProps={{ "aria-label": `${prefix}${model}` }}
                data-testid={`vk-model-${prefix}${model}`}
              >
                <Text fontSize="xs" fontFamily="mono">
                  {model}
                </Text>
              </Checkbox>
            ))}
          </Wrap>
        </Box>
      )}
    </VStack>
  );
}
