/**
 * Retention policies, as a reader configures them.
 *
 * `platform/app/src/pages/settings/data-retention.tsx`, moved whole. What
 * changed is only what a feature-web package may not own:
 *
 * - `SettingsLayout` does not travel. Chrome belongs to the route tree, and
 *   `apps/ui` mounts the harvested settings layout around this screen.
 * - `withPermissionGuard("project:view")` does not travel either; the frontend
 *   feature states the same policy in front of the same loader.
 * - The organization, the team, the project, the plan tier, the platform-admin
 *   flag, the address and both toasts are the host's.
 * - The scope filter reads and writes `?scope=` directly rather than mirroring
 *   it into component state. Every value the old hook could hold survives the
 *   round trip through the address, so the mirror only ever risked disagreeing
 *   with the URL.
 *
 * RECORDED COST: `UiFeedbackPort` has two levels and `toaster` had four. The
 * amber "Saved 7 of 9 updates" line and the blue "Applying retention to existing
 * data…" line are both success-lane notices now. The words are unchanged and the
 * error toast beside the first is what still tells the reader something failed;
 * only the colour is gone. Widening the capability is a change to a port every
 * family shares, and a page move is not where that belongs.
 *
 * Spec: specs/data-retention/retention-policy-configuration.feature
 */

import {
  Alert,
  Badge,
  Button,
  Card,
  EmptyState,
  Heading,
  HStack,
  Spacer,
  Spinner,
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
} from "@langwatch/authz-web/surfaces/scope-picker";
import {
  PLATFORM_DEFAULT_RETENTION_DAYS,
  retentionCategories,
  type RetentionCategory,
} from "@langwatch/data-retention-contract";
import { Menu } from "@langwatch/design-system/menu";
import { DatabaseBackup, MoreVertical, Pencil, Plus, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { dataRetentionApi } from "../../behavior/data-retention-api";
import { useDataRetentionHost, type DataRetentionHostPort } from "../../model/data-retention-host";
import { BINDING_SCOPE_TIERS, SCOPE_ICON } from "../../model/retention-constants";
import { formatDays } from "../../model/retention-format";
import {
  groupRulesByScope,
  renderPolicyValue,
  type RetentionScopeGroup,
} from "../../model/retention-grouping";
import { retentionRemovalPreviewQuery } from "../../model/retention-removal-preview";
import { AddOverrideDrawer, type RetentionEditTarget } from "../../ui/blocks/add-override-drawer";
import { ApplyToExistingConfirmDialog } from "../../ui/blocks/apply-to-existing-confirm-dialog";
import { RemoveScopeConfirmDialog } from "../../ui/blocks/remove-scope-confirm-dialog";
import { RetentionAndUsageCard } from "../../ui/blocks/retention-and-usage-card";
import { RetroactiveProgressCard } from "../../ui/blocks/retroactive-progress-card";

/** The query parameter the scope filter lives in. Unchanged from the page. */
export const RETENTION_SCOPE_QUERY_KEY = "scope";

export default function DataRetentionScreen() {
  const host = useDataRetentionHost();
  const { projectId } = host.scope();
  // Every retention row belongs to a project; without one in scope the page
  // renders nothing, which is what the platform page did.
  if (!projectId) return null;
  return <DataRetentionPage host={host} projectId={projectId} />;
}

function DataRetentionPage({
  host,
  projectId,
}: {
  host: DataRetentionHostPort;
  projectId: string;
}) {
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
  const storageScope =
    resolvedScopeFilter.kind === "specific"
      ? {
          scopeType: resolvedScopeFilter.scopeType,
          scopeId: resolvedScopeFilter.scopeId,
        }
      : organizationId
        ? { scopeType: "ORGANIZATION" as const, scopeId: organizationId }
        : { scopeType: "PROJECT" as const, scopeId: projectId };

  const storageDescription =
    resolvedScopeFilter.kind === "all"
      ? "How much space everything you can see uses today."
      : resolvedScopeFilter.scopeType === "ORGANIZATION"
        ? "How much space this organization's data uses today."
        : resolvedScopeFilter.scopeType === "TEAM"
          ? "How much space this team's data uses today."
          : "How much space this project's data uses today.";

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
    return (
      <VStack width="full" padding={8}>
        <Spinner />
      </VStack>
    );
  }

  const snapshot = rulesQuery.data;
  const available = snapshot?.available;
  const canConfigureRetention = !!snapshot?.canConfigureRetention;
  // Configurable retention is a paid-plan feature — even an org admin on
  // the free plan can't add overrides. Both gates must pass.
  const canWrite =
    canConfigureRetention &&
    !!available &&
    (!!available.organization || available.teams.length > 0 || available.projects.length > 0);

  const removeScopeGroup = async (group: RetentionScopeGroup) => {
    const categories = (Object.keys(group.byCategory) as RetentionCategory[]).filter(
      (category) => group.byCategory[category] !== undefined,
    );
    const results = await Promise.all(
      categories.map((category) =>
        removeForScope
          .mutateAsync({
            projectId,
            scope: { scopeType: group.scopeType, scopeId: group.scopeId },
            category,
          })
          .then(
            () => ({ ok: true as const }),
            (error: unknown) => ({ ok: false as const, error }),
          ),
      ),
    );
    void invalidate();
    const failed = results.filter((result) => !result.ok);
    if (failed.length === 0) {
      host.succeeded({
        title: categories.length === 1 ? "Override removed" : "Retention policy removed",
      });
    } else {
      const firstError = failed.find(
        (result): result is { ok: false; error: unknown } => !result.ok,
      );
      host.failed({
        error: firstError?.error,
        fallbackTitle: "Couldn't remove the retention policy",
      });
    }
  };

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

  const hierarchy = scopeHierarchyOf(filterAvailable);
  const filteredRules = (snapshot?.rules ?? []).filter((rule) =>
    isScopeInFilter(
      { scopeType: rule.scopeType, scopeId: rule.scopeId },
      resolvedScopeFilter,
      hierarchy,
    ),
  );
  const scopeGroups = groupRulesByScope(filteredRules).sort(
    (left, right) =>
      BINDING_SCOPE_TIERS[left.scopeType] - BINDING_SCOPE_TIERS[right.scopeType] ||
      left.name.localeCompare(right.name),
  );

  return (
    <VStack gap={6} width="full" align="start" paddingX={6} paddingY={4}>
      <HStack width="full" marginTop={2}>
        <Heading as="h2" fontSize="xl">
          Retention Policies
        </Heading>
        <Spacer />
        <ScopeFilter
          value={scopeFilter}
          onChange={setScopeFilter}
          available={filterAvailable}
          currentTeamId={teamId}
          currentProjectId={projectId}
        />
        {canWrite && (
          <Button colorPalette="blue" onClick={() => setDrawerOpen(true)}>
            Add retention policy
          </Button>
        )}
      </HStack>

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

      {snapshot && snapshot.rules.length === 0 ? (
        <Card.Root width="full">
          <Card.Body>
            <EmptyState.Root width="full">
              <EmptyState.Content>
                <EmptyState.Indicator>
                  <DatabaseBackup size={24} />
                </EmptyState.Indicator>
                <VStack textAlign="center" gap={3}>
                  <VStack textAlign="center" gap={1}>
                    <EmptyState.Title>No retention policies</EmptyState.Title>
                    <EmptyState.Description>
                      Add a retention policy to override the platform default of{" "}
                      {PLATFORM_DEFAULT_RETENTION_DAYS} days.
                    </EmptyState.Description>
                  </VStack>
                  {canWrite && (
                    <Button
                      colorPalette="blue"
                      variant="outline"
                      onClick={() => setDrawerOpen(true)}
                    >
                      <Plus /> Add retention policy
                    </Button>
                  )}
                </VStack>
              </EmptyState.Content>
            </EmptyState.Root>
          </Card.Body>
        </Card.Root>
      ) : snapshot && snapshot.rules.length > 0 && scopeGroups.length === 0 ? (
        <Card.Root width="full">
          <Card.Body>
            <Text fontSize="sm" color="fg.muted" textAlign="center">
              No retention policies match the current scope filter.
            </Text>
          </Card.Body>
        </Card.Root>
      ) : (
        snapshot &&
        scopeGroups.length > 0 && (
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
                                <Menu.Item value="edit" onClick={() => openEditForGroup(group)}>
                                  <Pencil size={14} /> Edit
                                </Menu.Item>
                                <Menu.Item
                                  value="remove"
                                  color="red.500"
                                  onClick={() => setRemoveTarget(group)}
                                >
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
        )
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
          onSave={async ({ scopes, retentionDays, applyToExisting }) => {
            const categories: RetentionCategory[] = [...retentionCategories];
            const saveOverrides = async () => {
              const pairs = scopes.flatMap((scope) =>
                categories.map((category) => ({ scope, category })),
              );
              const results = await Promise.all(
                pairs.map(({ scope, category }) =>
                  setForScope.mutateAsync({ projectId, scope, category, retentionDays }).then(
                    () => ({ ok: true as const, category }),
                    (error: unknown) => ({ ok: false as const, category, error }),
                  ),
                ),
              );
              void invalidate();
              return { pairs, results };
            };

            const reportSaveResults = ({
              pairs,
              results,
            }: Awaited<ReturnType<typeof saveOverrides>>) => {
              const failed = results.filter((result) => !result.ok);
              if (failed.length === 0) {
                host.succeeded({
                  title:
                    scopes.length === 1
                      ? "Retention policy saved"
                      : `Retention policy saved for ${scopes.length} scopes`,
                });
                return { success: true, failed: [] };
              }
              const firstError = failed.find(
                (result): result is { ok: false; category: RetentionCategory; error: unknown } =>
                  !result.ok,
              );
              // The partial count is an outcome, not an error headline: a
              // recognised code overrides `fallbackTitle`, which would erase
              // "Saved 7 of 9". Report the two things separately.
              if (failed.length < pairs.length) {
                host.succeeded({
                  title: `Saved ${pairs.length - failed.length} of ${pairs.length} updates`,
                });
              }
              host.failed({
                error: firstError?.error,
                fallbackTitle: "Couldn't save the retention policy",
              });
              return {
                success: failed.length === 0,
                failed: failed.map((result) => result.category),
              };
            };

            if (!applyToExisting) {
              const result = await saveOverrides();
              const status = reportSaveResults(result);
              if (status.success) closeDrawer();
              return;
            }

            const savedScopeWiderThanCurrentProject = scopes.some(
              (scope) => !(scope.scopeType === "PROJECT" && scope.scopeId === projectId),
            );
            setPendingConfirm({
              retentionDays,
              savedScopeWiderThanCurrentProject,
              onConfirm: async () => {
                const result = await saveOverrides();
                const status = reportSaveResults(result);

                const succeededCategories = Array.from(
                  new Set(
                    result.results.filter((entry) => entry.ok).map((entry) => entry.category),
                  ),
                );
                if (succeededCategories.length > 0) {
                  // The server uses the cascade-aware resolver
                  // (PROJECT > TEAM > ORGANIZATION > platform default), so
                  // saving an org/team rule when the project already has a
                  // closer override applies the project's value, NOT the
                  // saved value. The server returns the value it actually
                  // used; we surface that in the notice so the user sees the
                  // truth (not the form value they typed).
                  const triggerResults = await Promise.all(
                    succeededCategories.map((category) =>
                      triggerUpdate.mutateAsync({ projectId, category }).then(
                        (response) => ({
                          ok: true as const,
                          applied: response.appliedRetentionDays,
                        }),
                        (error: unknown) => ({ ok: false as const, error }),
                      ),
                    ),
                  );
                  const triggerFailed = triggerResults.filter((entry) => !entry.ok);
                  if (triggerFailed.length === 0) {
                    const appliedValues = Array.from(
                      new Set(
                        triggerResults
                          .filter((entry): entry is { ok: true; applied: number } => entry.ok)
                          .map((entry) => entry.applied),
                      ),
                    );
                    const description =
                      appliedValues.length === 1
                        ? `Rewriting existing rows to ${formatDays(appliedValues[0]!)}.`
                        : `Rewriting existing rows per category (${appliedValues
                            .map(formatDays)
                            .join(", ")}).`;
                    host.succeeded({
                      title: "Applying retention to existing data…",
                      description,
                    });
                  } else {
                    const firstError = triggerFailed.find(
                      (entry): entry is { ok: false; error: unknown } => !entry.ok,
                    );
                    host.failed({
                      error: firstError?.error,
                      fallbackTitle: "Some retroactive updates failed",
                    });
                  }
                }
                if (status.success) closeDrawer();
              },
            });
          }}
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
          await removeScopeGroup(removeTarget);
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
  );
}
