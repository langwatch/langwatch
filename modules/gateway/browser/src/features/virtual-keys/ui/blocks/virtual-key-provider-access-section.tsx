import { HStack, Spinner, Text, VStack } from "@chakra-ui/react";
import { Checkbox } from "@langwatch/design-system/checkbox";
import { FieldInfoTooltip } from "@langwatch/design-system/field-info-tooltip";
import { SmallLabel } from "@langwatch/design-system/small-label";
import { useMemo } from "react";

import {
  buildScopeHierarchy,
  type ModelProviderScopeEntry,
  type OrgModelProvider,
  resolveEligible,
  type VirtualKeyScopeEntry,
} from "../../model/eligible-model-providers.ts";
import { ProviderRow } from "./virtual-key-provider-row.tsx";

/**
 * Which providers a key may dispatch to. `allProviders: true` persists as
 * `providers_allowed: null` — every provider the key's ownership reaches,
 * including ones added later; an explicit selection never grows on its own.
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
  eligible: { id: string }[],
): { providersAllowed: string[] | null; modelsAllowed: string[] | null } {
  const eligibleIds = new Set(eligible.map((e) => e.id));
  return {
    providersAllowed: value.allProviders
      ? null
      : value.providerIds.filter((id) => eligibleIds.has(id)),
    modelsAllowed: value.modelsAllowed.length > 0 ? value.modelsAllowed : null,
  };
}

/** Why the current selection cannot be saved, or null when it can. */
export function providerAccessInvalidReason(
  value: ProviderAccessValue,
  eligible: { id: string }[],
): string | null {
  if (value.allProviders) return null;
  const eligibleIds = new Set(eligible.map((e) => e.id));
  if (value.providerIds.filter((id) => eligibleIds.has(id)).length === 0) {
    return "Select at least one provider, or allow all providers.";
  }
  return null;
}

/** The models a provider row can serve, in bare form. */

/**
 * Checkbox list of every provider this key's ownership reaches, with a
 * per-provider model accordion for "only these models". "All" is the
 * future-proof default: stored as no list, so a later provider needs no edit.
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
  availableTeams: { id: string; name: string }[];
  availableProjects: { id: string; name: string; teamId?: string }[];
  providers: OrgModelProvider[];
  isLoading?: boolean;
}) {
  const hierarchy = useMemo(
    () => buildScopeHierarchy(availableProjects, organizationId),
    [availableProjects, organizationId],
  );
  const eligible = useMemo(
    () => resolveEligible({ scopes, providers, hierarchy }),
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
            // Unchecking "All providers" clears the selection, so no row
            // stays checked. The invalid-reason note then asks the operator
            // to pick at least one provider or re-check "All".
            providerIds: [],
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

  const showNoScopes = !isLoading && scopes.length === 0;
  const showNoEligible = !isLoading && scopes.length > 0 && eligible.length === 0;
  const showReady = !isLoading && scopes.length > 0 && eligible.length > 0;

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

      {isLoading && (
        <HStack gap={2}>
          <Spinner size="xs" />
          <Text fontSize="xs" color="fg.muted">
            Resolving providers…
          </Text>
        </HStack>
      )}
      {showNoScopes && (
        <Text fontSize="xs" color="fg.muted">
          Pick an ownership above to see the providers this key can reach.
        </Text>
      )}
      {showNoEligible && (
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
      )}
      {showReady && (
        <VStack align="stretch" width="full" gap={1}>
          <HStack paddingX={0.5} paddingY={1}>
            <Checkbox
              size="sm"
              checked={value.allProviders}
              onCheckedChange={(d: { checked: unknown }) => toggleAll(d.checked === true)}
              inputProps={{ "aria-label": "All providers" }}
              data-testid="vk-providers-all"
            >
              <Text fontSize="sm" fontWeight="medium">
                All providers
              </Text>
            </Checkbox>
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
              onModelsAllowedChange={(modelsAllowed) => onChange({ ...value, modelsAllowed })}
            />
          ))}
          {invalidReason && (
            <Text fontSize="xs" color="red.600" data-testid="vk-providers-invalid">
              {invalidReason}
            </Text>
          )}
        </VStack>
      )}
    </VStack>
  );
}
