import {
  Box,
  Button,
  HStack,
  Spinner,
  Text,
  VStack,
  Wrap,
} from "@chakra-ui/react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { useMemo, useState } from "react";

import { SmallLabel } from "../SmallLabel";
import { Checkbox } from "~/components/ui/checkbox";
import { FieldInfoTooltip } from "~/components/ui/FieldInfoTooltip";
import { ProviderScopeChips } from "../settings/ProviderScopeChips";
import { modelProviderIcons } from "~/server/modelProviders/iconsMap";

import {
  buildScopeHierarchy,
  type EligibleModelProvider,
  type ModelProviderScopeEntry,
  type OrgModelProvider,
  resolveEligible,
  type VirtualKeyScopeEntry,
} from "./eligibleModelProviders";

/**
 * Which providers a key may dispatch to.
 *
 * `allProviders: true` persists as `providers_allowed: null`: every
 * provider the key can reach through its ownership, including providers
 * added later. An explicit selection persists the listed ModelProvider
 * row ids and never grows on its own.
 */
export type ProviderAccessValue = {
  allProviders: boolean;
  /** ModelProvider row ids; consulted only when `allProviders` is false. */
  providerIds: string[];
  /** `vendor/model` wire ids. Empty = every model the providers serve. */
  modelsAllowed: string[];
};

export const ALL_PROVIDERS: ProviderAccessValue = {
  allProviders: true,
  providerIds: [],
  modelsAllowed: [],
};

/** What the mutation should persist for this selection. */
export function providerAccessToConfig(
  value: ProviderAccessValue,
  eligible: Array<{ id: string }>,
): { providersAllowed: string[] | null; modelsAllowed: string[] | null } {
  const eligibleIds = new Set(eligible.map((e) => e.id));
  return {
    providersAllowed: value.allProviders
      ? null
      : value.providerIds.filter((id) => eligibleIds.has(id)),
    modelsAllowed:
      value.modelsAllowed.length > 0 ? value.modelsAllowed : null,
  };
}

/** Why the current selection cannot be saved, or null when it can. */
export function providerAccessInvalidReason(
  value: ProviderAccessValue,
  eligible: Array<{ id: string }>,
): string | null {
  if (value.allProviders) return null;
  const eligibleIds = new Set(eligible.map((e) => e.id));
  if (value.providerIds.filter((id) => eligibleIds.has(id)).length === 0) {
    return "Select at least one provider, or allow all providers.";
  }
  return null;
}

/** The models a provider row can serve, in bare form. */
function providerModels(provider: OrgModelProvider | undefined): string[] {
  if (!provider) return [];
  const registry = provider.models ?? [];
  const custom = (provider.customModels ?? []).map((m) => m.modelId);
  return [...new Set([...registry, ...custom])];
}

/**
 * Checkbox list of every provider this key's ownership reaches, with the
 * scope the provider comes from, and a per-provider model accordion for
 * the uncommon "only these models" path. The "All" master checkbox is
 * the future-proof default: it is stored as the absence of a list, which
 * is what keeps a provider added next month reachable without editing
 * the key.
 */
export function VirtualKeyProviderAccessSection({
  value,
  onChange,
  scopes,
  organizationId,
  organizationName,
  availableTeams,
  availableProjects,
  providers,
  isLoading,
}: {
  value: ProviderAccessValue;
  onChange: (next: ProviderAccessValue) => void;
  scopes: VirtualKeyScopeEntry[];
  organizationId: string | undefined;
  organizationName?: string;
  availableTeams: Array<{ id: string; name: string }>;
  availableProjects: Array<{ id: string; name: string; teamId?: string }>;
  providers: OrgModelProvider[];
  isLoading?: boolean;
}) {
  const hierarchy = useMemo(
    () => buildScopeHierarchy(availableProjects, organizationId),
    [availableProjects, organizationId],
  );
  const eligible = useMemo(
    () => resolveEligible(scopes, providers, hierarchy),
    [scopes, providers, hierarchy],
  );
  const providerById = useMemo(
    () => new Map(providers.filter((p) => p.id).map((p) => [p.id!, p])),
    [providers],
  );
  const names = useMemo(() => {
    const teamNames = new Map(availableTeams.map((t) => [t.id, t.name]));
    const projectNames = new Map(
      availableProjects.map((p) => {
        const clean = p.name.split(" · ")[0] ?? p.name;
        return [p.id, clean] as const;
      }),
    );
    return { organizationName, teamNames, projectNames };
  }, [availableTeams, availableProjects, organizationName]);

  const scopeName = (scope: ModelProviderScopeEntry): string | undefined => {
    switch (scope.scopeType) {
      case "ORGANIZATION":
        return names.organizationName;
      case "TEAM":
        return names.teamNames.get(scope.scopeId);
      case "PROJECT":
        return names.projectNames.get(scope.scopeId);
    }
  };

  const selected = useMemo(() => new Set(value.providerIds), [value]);

  const toggleAll = (checked: boolean) => {
    onChange(
      checked
        ? { ...value, allProviders: true, providerIds: [] }
        : {
            ...value,
            allProviders: false,
            // Start from everything selected so narrowing is one
            // uncheck away instead of N re-checks.
            providerIds: eligible.map((mp) => mp.id),
          },
    );
  };

  const toggleProvider = (id: string, checked: boolean) => {
    const next = new Set(selected);
    if (checked) next.add(id);
    else next.delete(id);
    onChange({ ...value, allProviders: false, providerIds: [...next] });
  };

  const invalidReason = providerAccessInvalidReason(value, eligible);

  return (
    <VStack align="start" width="full" gap={1.5}>
      <HStack gap={1} alignItems="center">
        <SmallLabel>Provider access</SmallLabel>
        <FieldInfoTooltip
          description="Which model providers this key may dispatch to. 'All providers' keeps the key current: providers added to its scope later become reachable without editing the key. An explicit selection stays exactly as picked. Expand a provider to limit which of its models the key may call."
          docHref="/ai-gateway/virtual-keys"
          testId="vk-provider-access-info"
        />
      </HStack>

      {isLoading ? (
        <HStack gap={2}>
          <Spinner size="xs" />
          <Text fontSize="xs" color="fg.muted">
            Resolving providers…
          </Text>
        </HStack>
      ) : scopes.length === 0 ? (
        <Text fontSize="xs" color="fg.muted">
          Pick an ownership above to see the providers this key can reach.
        </Text>
      ) : eligible.length === 0 ? (
        <VStack
          align="stretch"
          gap={1}
          width="full"
          borderWidth="1px"
          borderColor="orange.200"
          borderRadius="md"
          background="orange.50"
          padding={3}
        >
          <Text fontSize="sm" fontWeight="medium">
            No model providers reachable from this ownership.
          </Text>
          <Text fontSize="xs" color="fg.muted">
            Add one at{" "}
            <Text as="span" fontFamily="mono">
              /settings/model-providers
            </Text>{" "}
            first; the key cannot route requests without a provider.
          </Text>
        </VStack>
      ) : (
        <VStack align="stretch" width="full" gap={1}>
          <HStack paddingX={0.5} paddingY={1}>
            <Checkbox
              size="sm"
              checked={value.allProviders}
              onCheckedChange={(d: { checked: unknown }) =>
                toggleAll(d.checked === true)
              }
              inputProps={{ "aria-label": "All providers" }}
              data-testid="vk-providers-all"
            >
              <Text fontSize="sm" fontWeight="medium">
                All providers
              </Text>
            </Checkbox>
            <Text fontSize="xs" color="fg.muted">
              current and future
            </Text>
          </HStack>
          {eligible.map((mp) => (
            <ProviderRow
              key={mp.id}
              mp={mp}
              raw={providerById.get(mp.id)}
              allProviders={value.allProviders}
              checked={value.allProviders || selected.has(mp.id)}
              onCheck={(checked) => toggleProvider(mp.id, checked)}
              scopeName={scopeName(mp.definedAt)}
              modelsAllowed={value.modelsAllowed}
              onModelsAllowedChange={(modelsAllowed) =>
                onChange({ ...value, modelsAllowed })
              }
            />
          ))}
          {invalidReason && (
            <Text
              fontSize="xs"
              color="red.600"
              data-testid="vk-providers-invalid"
            >
              {invalidReason}
            </Text>
          )}
        </VStack>
      )}
    </VStack>
  );
}

function ProviderRow({
  mp,
  raw,
  allProviders,
  checked,
  onCheck,
  scopeName,
  modelsAllowed,
  onModelsAllowedChange,
}: {
  mp: EligibleModelProvider;
  raw: OrgModelProvider | undefined;
  allProviders: boolean;
  checked: boolean;
  onCheck: (checked: boolean) => void;
  scopeName: string | undefined;
  modelsAllowed: string[];
  onModelsAllowedChange: (next: string[]) => void;
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
        <Text fontSize="sm" fontWeight="medium">
          {mp.label}
        </Text>
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
