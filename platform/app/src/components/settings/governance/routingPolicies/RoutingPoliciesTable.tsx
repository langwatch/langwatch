import { Badge, Box, Button, HStack, Spacer, Text, VStack } from "@chakra-ui/react";
import { Plus } from "lucide-react";

import { ProviderScopeChips } from "~/components/settings/ProviderScopeChips";
import type { ScopeTriadEntry } from "~/components/settings/ScopeChipPicker";
import { isModelTier } from "~/utils/modelTierPresets";

import { RoutingPolicyRowActions } from "./RoutingPolicyRowActions";

export type RoutingPolicyScopeLevel = "organization" | "team" | "project";

export interface RoutingPolicyRow {
  id: string;
  name: string;
  description: string | null;
  isDefault: boolean;
  modelProviderIds: unknown;
  modelAliases: unknown;
  defaultModel: string | null;
  scopes: Array<{ scopeType: string; scopeId: string }>;
}

const SCOPE_LEVELS: Array<{
  level: RoutingPolicyScopeLevel;
  label: string;
  subtitle: string;
}> = [
  {
    level: "organization",
    label: "Organization",
    subtitle: "Applies wherever no team or project sets its own",
  },
  {
    level: "team",
    label: "Teams",
    subtitle: "Overrides the organization policy for one team",
  },
  {
    level: "project",
    label: "Projects",
    subtitle: "Overrides everything above for one project",
  },
];

export function RoutingPoliciesTable({
  policies,
  resolveScopeNames,
  onNew,
  onEdit,
  onSetDefault,
  onDelete,
  canManage,
}: {
  policies: RoutingPolicyRow[];
  resolveScopeNames: (scopes: ScopeTriadEntry[]) => ScopeTriadEntry[];
  onNew: (level: RoutingPolicyScopeLevel) => void;
  onEdit: (policy: RoutingPolicyRow) => void;
  onSetDefault: (policy: RoutingPolicyRow) => void;
  onDelete: (policy: RoutingPolicyRow) => void;
  /**
   * Whether the viewer holds `routingPolicies:manage`. False hides the "New
   * policy" buttons and the per-row overflow menu, since every action behind
   * them is a write the server refuses without the grant.
   */
  canManage: boolean;
}) {
  const { bucketed, unplaced } = bucketByScopeLevel(policies);

  return (
    <>
      {SCOPE_LEVELS.map(({ level, label, subtitle }) => {
        const rows = bucketed.get(level) ?? [];
        return (
          <Box
            key={level}
            borderWidth="1px"
            borderColor="border.muted"
            borderRadius="md"
            padding={4}
          >
            <HStack alignItems="start" marginBottom={3}>
              <VStack align="start" gap={0}>
                <Text fontSize="sm" fontWeight="semibold">
                  {label}
                </Text>
                <Text fontSize="xs" color="fg.muted">
                  {subtitle}
                </Text>
              </VStack>
              <Spacer />
              {canManage && (
                <Button size="sm" variant="outline" onClick={() => onNew(level)}>
                  <Plus size={14} /> New policy
                </Button>
              )}
            </HStack>

            <VStack align="stretch" gap={2}>
              {rows.length === 0 && (
                <Text fontSize="sm" color="fg.muted">
                  No policies here yet.
                </Text>
              )}
              {rows.map((policy) => (
                <PolicyRow
                  key={policy.id}
                  policy={policy}
                  resolveScopeNames={resolveScopeNames}
                  onEdit={() => onEdit(policy)}
                  onSetDefault={() => onSetDefault(policy)}
                  onDelete={() => onDelete(policy)}
                  canManage={canManage}
                />
              ))}
            </VStack>
          </Box>
        );
      })}

      {unplaced.length > 0 && (
        <Box borderWidth="1px" borderColor="orange.300" borderRadius="md" padding={4}>
          <VStack align="start" gap={0} marginBottom={3}>
            <Text fontSize="sm" fontWeight="semibold">
              Elsewhere
            </Text>
            <Text fontSize="xs" color="fg.muted">
              These policies apply somewhere this page does not have a section for. They
              still route traffic, so they are listed here rather than hidden.
            </Text>
          </VStack>
          <VStack align="stretch" gap={2}>
            {unplaced.map((policy) => (
              <PolicyRow
                key={policy.id}
                policy={policy}
                resolveScopeNames={resolveScopeNames}
                onEdit={() => onEdit(policy)}
                onSetDefault={() => onSetDefault(policy)}
                onDelete={() => onDelete(policy)}
                canManage={canManage}
              />
            ))}
          </VStack>
        </Box>
      )}
    </>
  );
}

/**
 * Files every policy under the level of its first scope, and everything else
 * under `unplaced`.
 *
 * Nothing is dropped. A policy with no scope rows, or one naming a scope kind
 * this build predates, still routes traffic, and a policy an operator cannot
 * see is one they cannot fix. A policy that applies at several levels is
 * listed under the first one it names; its chips show the rest.
 */
function bucketByScopeLevel(policies: RoutingPolicyRow[]): {
  bucketed: Map<RoutingPolicyScopeLevel, RoutingPolicyRow[]>;
  unplaced: RoutingPolicyRow[];
} {
  const bucketed = new Map<RoutingPolicyScopeLevel, RoutingPolicyRow[]>(
    SCOPE_LEVELS.map(({ level }) => [level, []]),
  );
  const unplaced: RoutingPolicyRow[] = [];
  for (const policy of policies) {
    const level = String(
      policy.scopes[0]?.scopeType ?? "",
    ).toLowerCase() as RoutingPolicyScopeLevel;
    const bucket = bucketed.get(level);
    if (bucket) bucket.push(policy);
    else unplaced.push(policy);
  }
  return { bucketed, unplaced };
}

function PolicyRow({
  policy,
  resolveScopeNames,
  onEdit,
  onSetDefault,
  onDelete,
  canManage,
}: {
  policy: RoutingPolicyRow;
  resolveScopeNames: (scopes: ScopeTriadEntry[]) => ScopeTriadEntry[];
  onEdit: () => void;
  onSetDefault: () => void;
  onDelete: () => void;
  canManage: boolean;
}) {
  const providerCount = Array.isArray(policy.modelProviderIds)
    ? policy.modelProviderIds.length
    : 0;
  const { tierCount, mappingCount } = countAliases(policy.modelAliases);
  const answeredTiers = policy.defaultModel ? "every tier" : describeTiers(tierCount);

  return (
    <HStack
      borderWidth="1px"
      borderColor={policy.isDefault ? "blue.300" : "border.muted"}
      borderRadius="sm"
      padding={3}
      gap={3}
    >
      <VStack align="start" gap={1} flex={1} minWidth={0}>
        <HStack gap={2} flexWrap="wrap">
          <Text fontSize="sm" fontWeight="medium">
            {policy.name}
          </Text>
          {policy.isDefault && (
            <Badge colorPalette="blue" size="sm" variant="surface">
              default
            </Badge>
          )}
          <ProviderScopeChips
            scopes={resolveScopeNames(
              policy.scopes.map((scope) => ({
                scopeType: scope.scopeType as ScopeTriadEntry["scopeType"],
                scopeId: scope.scopeId,
              })),
            )}
            size="xs"
          />
        </HStack>
        {policy.description && (
          <Text fontSize="xs" color="fg.muted">
            {policy.description}
          </Text>
        )}
        <Text fontSize="xs" color="fg.muted">
          {providerCount} {providerCount === 1 ? "provider" : "providers"} ·{" "}
          {answeredTiers}
          {mappingCount > 0 &&
            ` · ${mappingCount} ${mappingCount === 1 ? "name mapping" : "name mappings"}`}
        </Text>
      </VStack>
      {canManage && (
        <RoutingPolicyRowActions
          policyName={policy.name}
          isDefault={policy.isDefault}
          onEdit={onEdit}
          onSetDefault={onSetDefault}
          onDelete={onDelete}
        />
      )}
    </HStack>
  );
}

function countAliases(raw: unknown): {
  tierCount: number;
  mappingCount: number;
} {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { tierCount: 0, mappingCount: 0 };
  }
  let tierCount = 0;
  let mappingCount = 0;
  for (const key of Object.keys(raw as Record<string, unknown>)) {
    if (isModelTier(key)) tierCount += 1;
    else mappingCount += 1;
  }
  return { tierCount, mappingCount };
}

function describeTiers(count: number): string {
  if (count === 0) return "no model tiers";
  return `${count} model ${count === 1 ? "tier" : "tiers"}`;
}
