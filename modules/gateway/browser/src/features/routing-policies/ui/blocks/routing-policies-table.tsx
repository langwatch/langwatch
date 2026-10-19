import { ListTable } from "@langwatch/design-system/list-table";
import { NoDataInfoBlock } from "@langwatch/design-system/no-data-info-block";
import { Badge, HStack, Text, VStack } from "@langwatch/design-system/primitives";
import { ProviderScopeChips } from "@langwatch/design-system/provider-scope-chips";
import type { ScopeTriadEntry } from "@langwatch/design-system/scope-chip-picker";
import { Fragment } from "react";

import { isModelTier } from "../../model/model-tier-presets.ts";
import { RoutingPolicyRowActions } from "../elements/routing-policy-row-actions.tsx";

export type RoutingPolicyScopeLevel = "organization" | "team" | "project";

export interface RoutingPolicyRow {
  id: string;
  name: string;
  description: string | null;
  isDefault: boolean;
  modelProviderIds: unknown;
  modelAliases: unknown;
  defaultModel: string | null;
  scopes: { scopeType: string; scopeId: string }[];
}

const SCOPE_LEVELS: {
  level: RoutingPolicyScopeLevel;
  label: string;
  subtitle: string;
}[] = [
  {
    level: "organization",
    label: "Organization",
    subtitle: "Applies wherever no team or project sets its own",
  },
  {
    level: "team",
    label: "Team",
    subtitle: "Overrides the organization policy for one team",
  },
  {
    level: "project",
    label: "Project",
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
   * Whether the viewer holds `routingPolicies:manage`. False hides the add links
   * and the per-row overflow menu, since every action behind
   * them is a write the server refuses without the grant.
   */
  canManage: boolean;
}) {
  const { bucketed, unplaced } = bucketByScopeLevel(policies);
  const renderRow = (policy: RoutingPolicyRow) => (
    <ListTable.Row key={policy.id}>
      <ListTable.Cell>
        <PolicyRow
          policy={policy}
          resolveScopeNames={resolveScopeNames}
          onEdit={() => onEdit(policy)}
          onSetDefault={() => onSetDefault(policy)}
          onDelete={() => onDelete(policy)}
          canManage={canManage}
        />
      </ListTable.Cell>
    </ListTable.Row>
  );

  return (
    <ListTable>
      <ListTable.Body>
        {SCOPE_LEVELS.map(({ level, label, subtitle }) => {
          const rows = bucketed.get(level) ?? [];
          return (
            <Fragment key={level}>
              <GroupHeadingRow label={label} subtitle={subtitle} />
              {rows.map(renderRow)}
              {rows.length === 0 && (
                <ListTable.SpanRow columns={1}>
                  <HStack paddingX={4}>
                    <NoDataInfoBlock
                      size="line"
                      title="No policies here yet."
                      action={
                        canManage
                          ? {
                              label: `Add ${label.toLowerCase()} policy`,
                              onClick: () => onNew(level),
                            }
                          : void 0
                      }
                    />
                  </HStack>
                </ListTable.SpanRow>
              )}
            </Fragment>
          );
        })}
        {unplaced.length > 0 && (
          <>
            <GroupHeadingRow
              label="Elsewhere"
              subtitle="These policies apply somewhere this page does not have a section for. They still route traffic, so they are listed here rather than hidden."
            />
            {unplaced.map(renderRow)}
          </>
        )}
      </ListTable.Body>
    </ListTable>
  );
}

function GroupHeadingRow({ label, subtitle }: { label: string; subtitle: string }) {
  return (
    <ListTable.SpanRow columns={1} band>
      <VStack align="start" gap={0} paddingX={4} paddingY={3}>
        <Text textStyle="sm" fontWeight="semibold">
          {label}
        </Text>
        <Text textStyle="xs" color="fg.muted">
          {subtitle}
        </Text>
      </VStack>
    </ListTable.SpanRow>
  );
}

/**
 * Groups policies by their first scope level, with unsupported scopes grouped as "unplaced".
 * Ensures all policies remain visible for operator review.
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
  const providerCount = Array.isArray(policy.modelProviderIds) ? policy.modelProviderIds.length : 0;
  const { tierCount, mappingCount } = countAliases(policy.modelAliases);
  const answeredTiers = policy.defaultModel ? "every tier" : describeTiers(tierCount);

  return (
    <HStack paddingY={1} gap={3} data-testid="gateway-routing-policy-row">
      <VStack align="start" gap={1} flex={1} minWidth={0}>
        <HStack gap={2} flexWrap="wrap">
          <Text fontSize="sm" fontWeight="semibold">
            {policy.name}
          </Text>
          {policy.isDefault && (
            <Badge colorPalette="orange" size="sm" variant="surface">
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
          {providerCount} {providerCount === 1 ? "provider" : "providers"} · {answeredTiers}
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
