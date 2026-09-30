/**
 * Retention policies configuration screen moved from platform/app. Scope filter
 * reads the URL directly. See {@link specs/data-retention/retention-policy-configuration.feature}
 */

import {
  Alert,
  Badge,
  Button,
  Card,
  HStack,
  Spacer,
  Skeleton,
  Table,
  Text,
  VStack,
} from "@chakra-ui/react";
import {
  isScopeInFilter,
  resolveScopeFilter,
  ScopeChipPicker,
  ScopeFilter,
  scopeFilterAddressWrite,
  scopeFilterFromAddress,
  scopeHierarchyOf,
  type ScopeFilterValue,
} from "@langwatch/authz-browser-kit";
import {
  PLATFORM_DEFAULT_RETENTION_DAYS,
  type ScopeAssignment,
} from "@langwatch/data-retention-contract";
import { Menu } from "@langwatch/design-system/menu";
import { NoDataInfoBlock } from "@langwatch/design-system/no-data-info-block";
import { PageLayout } from "@langwatch/design-system/page-layout";
import { DatabaseBackup, MoreVertical, Pencil, Plus, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";

import { dataRetentionApi } from "../../behavior/data-retention-api.ts";
import {
  removeRetentionScope,
  retentionPolicySaver,
} from "../../behavior/retention-policy-save.ts";
import {
  RETENTION_SCOPE_QUERY_KEY,
  useDataRetentionHost,
  type DataRetentionHostApi,
} from "../../model/data-retention-host.ts";
import { BINDING_SCOPE_TIERS, SCOPE_ICON } from "../../model/retention-constants.ts";
import {
  groupRulesByScope,
  renderPolicyValue,
  type RetentionScopeGroup,
} from "../../model/retention-grouping.ts";
import { retentionRemovalPreviewQuery } from "../../model/retention-removal-preview.ts";
import { AddOverrideDrawer, type RetentionEditTarget } from "../blocks/add-override-drawer.tsx";
import { ApplyToExistingConfirmDialog } from "../blocks/apply-to-existing-confirm-dialog.tsx";
import { RemoveScopeConfirmDialog } from "../blocks/remove-scope-confirm-dialog.tsx";
import { RetentionAndUsageCard } from "../blocks/retention-and-usage-card.tsx";
import { RetroactiveProgressCard } from "../blocks/retroactive-progress-card.tsx";

export default function DataRetentionScreen() {
  const host = useDataRetentionHost();
  const { projectId } = host.scope();
  // Every retention row belongs to a project; without one in scope the page
  // renders nothing, which is what the platform page did.
  if (!projectId) return null;
  return <DataRetentionPage host={host} projectId={projectId} />;
}

function storageDescriptionFor(scopeFilter: ReturnType<typeof resolveScopeFilter>): string {
  if (scopeFilter.kind === "all") return "How much space everything you can see uses today.";
  if (scopeFilter.scopeType === "ORGANIZATION") {
    return "How much space this organization's data uses today.";
  }
  if (scopeFilter.scopeType === "TEAM") return "How much space this team's data uses today.";
  return "How much space this project's data uses today.";
}

function storageScopeFor({
  scopeFilter,
  organizationId,
  projectId,
}: {
  scopeFilter: ReturnType<typeof resolveScopeFilter>;
  organizationId: string | undefined;
  projectId: string;
}): ScopeAssignment {
  if (scopeFilter.kind === "specific") {
    return { scopeType: scopeFilter.scopeType, scopeId: scopeFilter.scopeId };
  }
  if (organizationId) return { scopeType: "ORGANIZATION", scopeId: organizationId };
  return { scopeType: "PROJECT", scopeId: projectId };
}

/**
 * Configurable retention is a paid-plan feature: even an org admin on the free plan
 * can't add overrides, so this gate and the plan's must both pass.
 */
function hasWritableScope(
  available: { organization?: unknown; teams: unknown[]; projects: unknown[] } | undefined,
): boolean {
  if (!available) return false;
  return !!available.organization || available.teams.length > 0 || available.projects.length > 0;
}

function DataRetentionPage({ host, projectId }: { host: DataRetentionHostApi; projectId: string }) {
  const { organizationId, teamId } = host.scope();
  const utils = dataRetentionApi.useUtils();
  const rulesQuery = dataRetentionApi.dataRetention.getRules.useQuery({ projectId });

  const filterAvailable = host.availableScopes();
  const scopeFilter = scopeFilterFromAddress({
    raw: host.route().query[RETENTION_SCOPE_QUERY_KEY],
    available: filterAvailable,
  });
  const setScopeFilter = (next: ScopeFilterValue) => {
    const write = scopeFilterAddressWrite(next, { teamId, projectId });
    if (write.kind === "keep") return;
    host.setQuery(
      {
        ...host.route().query,
        [RETENTION_SCOPE_QUERY_KEY]: write.kind === "set" ? write.value : void 0,
      },
      { replace: true },
    );
  };

  // Resolve the active scope filter once; everything below derives from this
  // single value so the storage scope, its description, and the row filter
  // can't drift from one another.
  const resolvedScopeFilter = resolveScopeFilter(scopeFilter, {
    currentTeamId: teamId,
    currentProjectId: projectId,
  });

  // Storage tracks the scope selector, not just the current project. Map the
  // active filter to a concrete scope: a specific pick passes through; "all you
  // can see" resolves to the whole org (or just this project for a personal
  // account with no org).
  const storageScope = storageScopeFor({
    scopeFilter: resolvedScopeFilter,
    organizationId,
    projectId,
  });

  const storageDescription = storageDescriptionFor(resolvedScopeFilter);

  const storageQuery = dataRetentionApi.dataRetention.getScopeStorageUsage.useQuery({
    projectId,
    scope: storageScope,
  });
  // Platform admin = an email in ADMIN_EMAILS, NOT an org admin. Only they may
  // disable retention; the route enforces this independently. It decides
  // nothing here but whether the drawer offers the "No retention" option.
  const isPlatformAdmin = host.isPlatformAdmin();
  // Enterprise (and self-hosted, which resolves to enterprise) gets the full
  // retention menu + custom; paid non-enterprise gets the fixed short pair.
  const isEnterprise = host.isEnterprise();

  const [drawerOpen, setDrawerOpen] = useState(false);
  // When set, the Add drawer opens in edit mode locked to this scope's policy.
  const [editTarget, setEditTarget] = useState<RetentionEditTarget | null>(null);
  // The scope-group pending removal — drives the confirm dialog so deletion is
  // a deliberate, explained action instead of a one-click trash button.
  const [removeTarget, setRemoveTarget] = useState<RetentionScopeGroup | null>(null);

  // Fallback preview for the remove-confirm dialog: owned here (transport is
  // an application concern) and passed down as controlled data so the dialog
  // itself stays presentation-only.
  const removePreview = retentionRemovalPreviewQuery(projectId, removeTarget);
  const removePreviewQuery = dataRetentionApi.dataRetention.previewScopeRemoval.useQuery(
    removePreview.input,
    removePreview.options,
  );

  const invalidate = () => utils.dataRetention.getRules.invalidate({ projectId });

  // Per-call toasts are intentionally omitted — the Add-policy drawer fans
  // out one setForScope per (scope × category) pair and stacks the toaster
  // column with identical "saved" messages. The drawer's onSave emits a
  // single aggregated notice after the batch resolves.
  const setForScope = dataRetentionApi.dataRetention.setForScope.useMutation();

  // Removing a scope's policy fans out one removeForScope call per category,
  // so we mirror the save-flow pattern: aggregate the result and emit a
  // single notice at the call site instead of one per mutation.
  const removeForScope = dataRetentionApi.dataRetention.removeForScope.useMutation();

  // Retroactive apply: stamp the project's EXISTING ClickHouse rows with the
  // effective retention. We don't know the stored _retention_days values
  // without an extra query (they could still be the migration default), so we
  // always route through the confirm dialog before mutating CH — the action is
  // irreversible if it contracts.
  const [pendingConfirm, setPendingConfirm] = useState<{
    retentionDays: number;
    /** True when the user saved at least one scope beyond the current project
     *  (org/team or a different project). Retroactive apply only ever runs on
     *  the current project; surfacing this in the dialog prevents a user from
     *  expecting an org-wide save to retro-stamp every child project. */
    savedScopeWiderThanCurrentProject: boolean;
    onConfirm: () => void | Promise<void>;
  } | null>(null);

  // Poll system.mutations while a retroactive apply is in flight, then idle.
  const projectIsWritable =
    rulesQuery.data?.available.projects.some((project) => project.id === projectId) ?? false;
  const [pollMs, setPollMs] = useState<number | false>(false);
  const progressQuery = dataRetentionApi.dataRetention.getMutationProgress.useQuery(
    { projectId },
    { enabled: projectIsWritable, refetchInterval: pollMs },
  );
  const activeMutations = progressQuery.data ?? [];
  useEffect(() => {
    setPollMs(activeMutations.length > 0 ? 3000 : false);
  }, [activeMutations.length]);

  // Per-call toasts intentionally omitted — the drawer flow fans this out one
  // call per category. Call sites emit a single aggregated notice.
  const triggerUpdate = dataRetentionApi.dataRetention.triggerRetroactiveUpdate.useMutation({
    onSuccess: () => {
      setPollMs(3000);
      void progressQuery.refetch();
    },
  });

  const killMutation = dataRetentionApi.dataRetention.killMutation.useMutation({
    onSuccess: () => {
      void progressQuery.refetch();
      host.succeeded({ title: "Retroactive update cancelled" });
    },
    onError: (error: unknown) =>
      host.failed({ error, fallbackTitle: "Couldn't cancel the retroactive update" }),
  });

  if (rulesQuery.isLoading) {
    return <Skeleton width="full" height="200px" />;
  }

  const snapshot = rulesQuery.data;
  const available = snapshot?.available;
  const canConfigureRetention = !!snapshot?.canConfigureRetention;
  const canWrite = canConfigureRetention && hasWritableScope(available);

  // Open the Add drawer in edit mode for a scope group. The drawer edits one
  // retention value applied to all categories, so we seed it with the group's
  // traces value (or the first present category for a divergent legacy group).
  const openEditForGroup = (group: RetentionScopeGroup) => {
    // Deterministic prefill: prefer traces, then a fixed category order, so a
    // divergent legacy group never depends on object key insertion order.
    const retentionDays =
      group.byCategory.traces ?? group.byCategory.scenarios ?? group.byCategory.experiments;
    if (retentionDays === undefined) return;
    setEditTarget({
      scope: { scopeType: group.scopeType, scopeId: group.scopeId },
      scopeName: group.name,
      retentionDays,
    });
    setDrawerOpen(true);
  };

  const closeDrawer = () => {
    setDrawerOpen(false);
    setEditTarget(null);
  };

  const savePolicy = retentionPolicySaver({
    projectId,
    notices: host,
    write: ({ scope, category, retentionDays }) =>
      setForScope.mutateAsync({ projectId, scope, category, retentionDays }),
    trigger: (category) => triggerUpdate.mutateAsync({ projectId, category }),
    afterWrite: () => void invalidate(),
    close: closeDrawer,
    confirm: setPendingConfirm,
  });

  const hierarchy = scopeHierarchyOf(filterAvailable);
  const filteredRules = (snapshot?.rules ?? []).filter((rule) =>
    isScopeInFilter(
      { scopeType: rule.scopeType, scopeId: rule.scopeId },
      resolvedScopeFilter,
      hierarchy,
    ),
  );
  const scopeGroups = groupRulesByScope(filteredRules).toSorted(
    (left, right) =>
      BINDING_SCOPE_TIERS[left.scopeType] - BINDING_SCOPE_TIERS[right.scopeType] ||
      left.name.localeCompare(right.name),
  );

  return (
    <>
      <PageLayout.Header>
        <PageLayout.Heading>Retention Policies</PageLayout.Heading>
        <Spacer />
        <ScopeFilter
          value={scopeFilter}
          onChange={setScopeFilter}
          available={filterAvailable}
          currentTeamId={teamId}
          currentProjectId={projectId}
        />
        {canWrite && (
          <PageLayout.HeaderButton onClick={() => setDrawerOpen(true)}>
            Add retention policy
          </PageLayout.HeaderButton>
        )}
      </PageLayout.Header>
      <VStack gap={6} width="full" align="start" paddingTop={4}>
        {!canConfigureRetention && snapshot && (
          <Alert.Root status="info">
            <Alert.Indicator />
            <Alert.Content>
              <Alert.Title>Configurable retention is a paid-plan feature</Alert.Title>
              <Alert.Description>
                Your plan applies the platform default to every project. Upgrade to configure
                per-organization, per-team, or per-project retention overrides.
              </Alert.Description>
            </Alert.Content>
          </Alert.Root>
        )}

        {snapshot && (
          <RetentionAndUsageCard
            effective={snapshot.effective}
            isLoading={storageQuery.isLoading}
            data={storageQuery.data}
            storageDescription={storageDescription}
          />
        )}

        {snapshot && (
          <RetentionPolicyList
            ruleCount={snapshot.rules.length}
            scopeGroups={scopeGroups}
            canWrite={canWrite}
            onAdd={() => setDrawerOpen(true)}
            onEdit={openEditForGroup}
            onRemove={setRemoveTarget}
          />
        )}

        <RetroactiveProgressCard
          mutations={activeMutations}
          onCancel={(mutationId) => killMutation.mutate({ projectId, mutationId })}
          isCancelling={killMutation.isPending}
        />

        {available && (
          <AddOverrideDrawer
            open={drawerOpen}
            onClose={closeDrawer}
            editTarget={editTarget}
            available={available}
            currentProjectId={projectId}
            isPlatformAdmin={isPlatformAdmin}
            isEnterprise={isEnterprise}
            isSaving={setForScope.isPending || triggerUpdate.isPending}
            scopePicker={({ value, onChange }) => (
              <ScopeChipPicker
                value={value}
                onChange={onChange}
                organizationId={available.organization?.id}
                organizationName={available.organization?.name}
                availableTeams={available.teams}
                availableProjects={available.projects}
                label=""
                currentOrganizationId={available.organization ? organizationId : undefined}
                currentTeamId={teamId}
                currentProjectId={projectId}
              />
            )}
            onSave={savePolicy}
          />
        )}

        <RemoveScopeConfirmDialog
          group={removeTarget}
          isRemoving={removeForScope.isPending}
          preview={{
            data: removePreviewQuery.data,
            isLoading: removePreviewQuery.isLoading,
            isError: removePreviewQuery.isError,
          }}
          onCancel={() => setRemoveTarget(null)}
          onConfirm={async () => {
            if (!removeTarget) return;
            await removeRetentionScope({
              group: removeTarget,
              remove: ({ scope, category }) =>
                removeForScope.mutateAsync({ projectId, scope, category }),
              afterWrite: () => void invalidate(),
              notices: host,
            });
            setRemoveTarget(null);
          }}
        />

        <ApplyToExistingConfirmDialog
          pending={pendingConfirm}
          isApplying={triggerUpdate.isPending || setForScope.isPending}
          onCancel={() => setPendingConfirm(null)}
          onConfirm={async () => {
            if (!pendingConfirm) return;
            const confirm = pendingConfirm.onConfirm;
            setPendingConfirm(null);
            await confirm();
          }}
        />
      </VStack>
    </>
  );
}

type RetentionPolicyListProps = {
  ruleCount: number;
  scopeGroups: RetentionScopeGroup[];
  canWrite: boolean;
  onAdd: () => void;
  onEdit: (group: RetentionScopeGroup) => void;
  onRemove: (group: RetentionScopeGroup) => void;
};

/** The policies in scope: an invitation when none exist, a note when the filter hides them. */
function RetentionPolicyList({
  ruleCount,
  scopeGroups,
  canWrite,
  onAdd,
  onEdit,
  onRemove,
}: RetentionPolicyListProps) {
  if (ruleCount === 0) {
    return (
      <NoDataInfoBlock
        title="No retention policies"
        description={`Add a retention policy to override the platform default of ${PLATFORM_DEFAULT_RETENTION_DAYS} days.`}
        icon={<DatabaseBackup size={24} />}
      >
        {canWrite && (
          <PageLayout.HeaderButton onClick={onAdd}>
            <Plus /> Add retention policy
          </PageLayout.HeaderButton>
        )}
      </NoDataInfoBlock>
    );
  }
  if (scopeGroups.length === 0) {
    return (
      <Card.Root width="full">
        <Card.Body>
          <Text fontSize="sm" color="fg.muted" textAlign="center">
            No retention policies match the current scope filter.
          </Text>
        </Card.Body>
      </Card.Root>
    );
  }
  return (
    <Card.Root width="full" overflow="hidden">
      <Card.Body paddingY={0} paddingX={0} overflowX="auto">
        <Table.Root variant="line" size="md" width="full">
          <Table.Header>
            <Table.Row>
              <Table.ColumnHeader>Scope</Table.ColumnHeader>
              <Table.ColumnHeader>Policy</Table.ColumnHeader>
              <Table.ColumnHeader />
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {scopeGroups.map((group) => {
              const Icon = SCOPE_ICON[group.scopeType];
              return (
                <Table.Row key={`${group.scopeType}:${group.scopeId}`}>
                  <Table.Cell>
                    <HStack gap={2}>
                      <Icon size={14} />
                      <Text>{group.name}</Text>
                      <Badge size="sm" colorPalette="gray">
                        {group.scopeType.toLowerCase()}
                      </Badge>
                    </HStack>
                  </Table.Cell>
                  <Table.Cell>{renderPolicyValue(group.byCategory)}</Table.Cell>
                  <Table.Cell textAlign="end">
                    {canWrite && (
                      <Menu.Root>
                        <Menu.Trigger asChild>
                          <Button
                            size="xs"
                            variant="ghost"
                            aria-label={`Actions for ${group.name}`}
                          >
                            <MoreVertical size={14} />
                          </Button>
                        </Menu.Trigger>
                        <Menu.Content>
                          <Menu.Item value="edit" onClick={() => onEdit(group)}>
                            <Pencil size={14} /> Edit
                          </Menu.Item>
                          <Menu.Item value="remove" color="red.500" onClick={() => onRemove(group)}>
                            <Trash2 size={14} /> Remove
                          </Menu.Item>
                        </Menu.Content>
                      </Menu.Root>
                    )}
                  </Table.Cell>
                </Table.Row>
              );
            })}
          </Table.Body>
        </Table.Root>
      </Card.Body>
    </Card.Root>
  );
}
