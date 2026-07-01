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
  DatabaseBackup,
  MoreVertical,
  Pencil,
  Plus,
  Trash2,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import {
  AddOverrideDrawer,
  type RetentionEditTarget,
} from "~/components/data-retention/AddOverrideDrawer";
import { ApplyToExistingConfirmDialog } from "~/components/data-retention/ApplyToExistingConfirmDialog";
import {
  SCOPE_ICON,
  SCOPE_TIER_ORDER,
} from "~/components/data-retention/constants";
import { formatDays } from "~/components/data-retention/format";
import {
  groupRulesByScope,
  type RetentionScopeGroup,
  renderPolicyValue,
} from "~/components/data-retention/grouping";
import { RemoveScopeConfirmDialog } from "~/components/data-retention/RemoveScopeConfirmDialog";
import { RetentionAndUsageCard } from "~/components/data-retention/RetentionAndUsageCard";
import { RetroactiveProgressCard } from "~/components/data-retention/RetroactiveProgressCard";
import SettingsLayout from "~/components/SettingsLayout";
import { ScopeFilter as ScopeFilterComponent } from "~/components/settings/ScopeFilter";
import { Menu } from "~/components/ui/menu";
import { toaster } from "~/components/ui/toaster";
import { withPermissionGuard } from "~/components/WithPermissionGuard";
import { useActivePlan } from "~/hooks/useActivePlan";
import { useAvailableScopes } from "~/hooks/useAvailableScopes";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { useUrlScopeFilter } from "~/hooks/useUrlScopeFilter";
import {
  PLATFORM_DEFAULT_RETENTION_DAYS,
  RETENTION_CATEGORIES,
  type RetentionCategory,
} from "~/server/data-retention/retentionPolicy.schema";
import { api } from "~/utils/api";
import {
  isScopeInFilter,
  resolveScopeFilter,
} from "~/utils/filterProvidersByScope";

function DataRetentionSettings() {
  const { project, organization, team } = useOrganizationTeamProject();
  // Available scopes + URL-driven filter must be hooks (run unconditionally)
  // so we compute them before the early return. Both gracefully accept
  // null/undefined inputs.
  const filterAvailable = useAvailableScopes(organization);
  const [scopeFilter, setScopeFilter] = useUrlScopeFilter({
    filterAvailable,
    teamId: team?.id,
    projectId: project?.id,
  });
  if (!project) return null;
  return (
    <DataRetentionPage
      projectId={project.id}
      organizationId={organization?.id}
      teamId={team?.id}
      filterAvailable={filterAvailable}
      scopeFilter={scopeFilter}
      onScopeFilterChange={setScopeFilter}
    />
  );
}

export default withPermissionGuard("project:view", {
  layoutComponent: SettingsLayout,
})(DataRetentionSettings);

function DataRetentionPage({
  projectId,
  organizationId,
  teamId,
  filterAvailable,
  scopeFilter,
  onScopeFilterChange,
}: {
  projectId: string;
  organizationId: string | undefined;
  teamId: string | undefined;
  filterAvailable: ReturnType<typeof useAvailableScopes>;
  scopeFilter: ReturnType<typeof useUrlScopeFilter>[0];
  onScopeFilterChange: ReturnType<typeof useUrlScopeFilter>[1];
}) {
  const utils = api.useUtils();
  const rulesQuery = api.dataRetention.getRules.useQuery({ projectId });

  // Resolve the active scope filter once; everything below derives from this
  // single value so the storage scope, its description, and the row filter
  // can't drift from one another.
  const resolvedScopeFilter = useMemo(
    () =>
      resolveScopeFilter(scopeFilter, {
        currentTeamId: teamId,
        currentProjectId: projectId,
      }),
    [scopeFilter, teamId, projectId],
  );

  // Storage tracks the scope selector, not just the current project. Map the
  // active filter to a concrete scope: a specific pick passes through; "all you
  // can see" resolves to the whole org (or just this project for a personal
  // account with no org).
  const storageScope = useMemo(() => {
    if (resolvedScopeFilter.kind === "specific") {
      return {
        scopeType: resolvedScopeFilter.scopeType,
        scopeId: resolvedScopeFilter.scopeId,
      };
    }
    return organizationId
      ? { scopeType: "ORGANIZATION" as const, scopeId: organizationId }
      : { scopeType: "PROJECT" as const, scopeId: projectId };
  }, [resolvedScopeFilter, projectId, organizationId]);

  const storageDescription = useMemo(() => {
    const resolved = resolvedScopeFilter;
    if (resolved.kind === "all") {
      return "How much space everything you can see uses today.";
    }
    if (resolved.scopeType === "ORGANIZATION") {
      return "How much space this organization's data uses today.";
    }
    if (resolved.scopeType === "TEAM") {
      return "How much space this team's data uses today.";
    }
    return "How much space this project's data uses today.";
  }, [resolvedScopeFilter]);

  const storageQuery = api.dataRetention.getScopeStorageUsage.useQuery({
    projectId,
    scope: storageScope,
  });
  // Platform admin = email in ADMIN_EMAILS (NOT an org admin). Only they may
  // disable retention; the route enforces this independently. We use it solely
  // to decide whether to surface the "No retention" option in the drawer.
  const isPlatformAdmin = api.user.isAdmin.useQuery({}).data?.isAdmin ?? false;
  // Enterprise (and self-hosted, which resolves to enterprise) gets the full
  // retention menu + custom; paid non-enterprise gets the fixed short pair.
  const { isEnterprise } = useActivePlan();

  const [drawerOpen, setDrawerOpen] = useState(false);
  // When set, the Add drawer opens in edit mode locked to this scope's policy.
  const [editTarget, setEditTarget] = useState<RetentionEditTarget | null>(
    null,
  );
  // The scope-group pending removal — drives the confirm dialog so deletion is
  // a deliberate, explained action instead of a one-click trash button.
  const [removeTarget, setRemoveTarget] = useState<RetentionScopeGroup | null>(
    null,
  );

  const invalidate = () =>
    utils.dataRetention.getRules.invalidate({ projectId });

  // Per-call toasts are intentionally omitted — the Add-policy drawer fans
  // out one setForScope per (scope × category) pair and stacks the toaster
  // column with identical "saved" messages. The drawer's onSave emits a
  // single aggregated toast after the batch resolves.
  const setForScope = api.dataRetention.setForScope.useMutation();

  // Removing a scope's policy fans out one removeForScope call per category,
  // so we mirror the save-flow pattern: aggregate the result and emit a
  // single toast at the call site instead of one per mutation.
  const removeForScope = api.dataRetention.removeForScope.useMutation();

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
    rulesQuery.data?.available.projects.some((p) => p.id === projectId) ??
    false;
  const [pollMs, setPollMs] = useState<number | false>(false);
  const progressQuery = api.dataRetention.getMutationProgress.useQuery(
    { projectId },
    { enabled: projectIsWritable, refetchInterval: pollMs },
  );
  const activeMutations = progressQuery.data ?? [];
  useEffect(() => {
    setPollMs(activeMutations.length > 0 ? 3000 : false);
  }, [activeMutations.length]);

  // Per-call toasts intentionally omitted — the drawer flow fans this out one
  // call per category. Call sites emit a single aggregated toast.
  const triggerUpdate = api.dataRetention.triggerRetroactiveUpdate.useMutation({
    onSuccess: () => {
      setPollMs(3000);
      void progressQuery.refetch();
    },
  });

  const killMutation = api.dataRetention.killMutation.useMutation({
    onSuccess: () => {
      void progressQuery.refetch();
      toaster.create({
        title: "Retroactive update cancelled",
        type: "success",
      });
    },
    onError: (error) =>
      toaster.create({
        title: "Failed to cancel",
        description: error.message,
        type: "error",
      }),
  });

  if (rulesQuery.isLoading) {
    return (
      <SettingsLayout>
        <VStack width="full" padding={8}>
          <Spinner />
        </VStack>
      </SettingsLayout>
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
    (!!available.organization ||
      available.teams.length > 0 ||
      available.projects.length > 0);

  const removeScopeGroup = async (group: RetentionScopeGroup) => {
    const categories = (
      Object.keys(group.byCategory) as RetentionCategory[]
    ).filter((c) => group.byCategory[c] !== undefined);
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
            (error: Error) => ({ ok: false as const, error }),
          ),
      ),
    );
    void invalidate();
    const failed = results.filter((r) => !r.ok);
    if (failed.length === 0) {
      toaster.create({
        title:
          categories.length === 1
            ? "Override removed"
            : "Retention policy removed",
        type: "success",
      });
    } else {
      const firstError = failed.find(
        (r): r is { ok: false; error: Error } => !r.ok,
      );
      toaster.create({
        title: "Failed to remove policy",
        description: firstError?.error.message,
        type: "error",
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
      group.byCategory.traces ??
      group.byCategory.scenarios ??
      group.byCategory.experiments;
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

  const filteredRules = (snapshot?.rules ?? []).filter((r) =>
    isScopeInFilter(
      { scopeType: r.scopeType, scopeId: r.scopeId },
      resolvedScopeFilter,
      filterAvailable.hierarchy,
    ),
  );
  const scopeGroups = groupRulesByScope(filteredRules).sort(
    (a, b) =>
      SCOPE_TIER_ORDER[a.scopeType] - SCOPE_TIER_ORDER[b.scopeType] ||
      a.name.localeCompare(b.name),
  );

  return (
    <SettingsLayout>
      <VStack gap={6} width="full" align="start" paddingX={6} paddingY={4}>
        <HStack width="full" marginTop={2}>
          <Heading as="h2" fontSize="xl">
            Retention Policies
          </Heading>
          <Spacer />
          <ScopeFilterComponent
            value={scopeFilter}
            onChange={onScopeFilterChange}
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
              <Alert.Title>
                Configurable retention is a paid-plan feature
              </Alert.Title>
              <Alert.Description>
                Your plan applies the platform default to every project. Upgrade
                to configure per-organization, per-team, or per-project
                retention overrides.
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
                        Add a retention policy to override the platform default
                        of {PLATFORM_DEFAULT_RETENTION_DAYS} days.
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
        ) : snapshot &&
          snapshot.rules.length > 0 &&
          scopeGroups.length === 0 ? (
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
                          <Table.Cell>
                            {renderPolicyValue(group.byCategory)}
                          </Table.Cell>
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
                                  <Menu.Item
                                    value="edit"
                                    onClick={() => openEditForGroup(group)}
                                  >
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
          onCancel={(mutationId) =>
            killMutation.mutate({ projectId, mutationId })
          }
          isCancelling={killMutation.isLoading}
        />

        {available && (
          <AddOverrideDrawer
            open={drawerOpen}
            onClose={closeDrawer}
            editTarget={editTarget}
            available={available}
            currentOrganizationId={organizationId}
            currentTeamId={teamId}
            currentProjectId={projectId}
            isPlatformAdmin={isPlatformAdmin}
            isEnterprise={isEnterprise}
            isSaving={setForScope.isLoading || triggerUpdate.isLoading}
            onSave={async ({ scopes, retentionDays, applyToExisting }) => {
              const categories: RetentionCategory[] = [...RETENTION_CATEGORIES];
              const saveOverrides = async () => {
                const pairs = scopes.flatMap((scope) =>
                  categories.map((category) => ({ scope, category })),
                );
                const results = await Promise.all(
                  pairs.map(({ scope, category }) =>
                    setForScope
                      .mutateAsync({
                        projectId,
                        scope,
                        category,
                        retentionDays,
                      })
                      .then(
                        () => ({ ok: true as const, category }),
                        (error: Error) => ({
                          ok: false as const,
                          category,
                          error,
                        }),
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
                const failed = results.filter((r) => !r.ok);
                if (failed.length === 0) {
                  toaster.create({
                    title:
                      scopes.length === 1
                        ? "Retention policy saved"
                        : `Retention policy saved for ${scopes.length} scopes`,
                    type: "success",
                  });
                  return { success: true, failed: [] };
                }
                const firstError = failed.find(
                  (
                    r,
                  ): r is {
                    ok: false;
                    category: RetentionCategory;
                    error: Error;
                  } => !r.ok,
                );
                toaster.create({
                  title:
                    failed.length === pairs.length
                      ? "Failed to save retention policy"
                      : `Saved ${pairs.length - failed.length} of ${pairs.length} updates`,
                  description: firstError?.error.message,
                  type: "error",
                });
                return {
                  success: failed.length === 0,
                  failed: failed.map((f) => f.category),
                };
              };

              if (!applyToExisting) {
                const result = await saveOverrides();
                const status = reportSaveResults(result);
                if (status.success) closeDrawer();
                return;
              }

              const savedScopeWiderThanCurrentProject = scopes.some(
                (s) => !(s.scopeType === "PROJECT" && s.scopeId === projectId),
              );
              setPendingConfirm({
                retentionDays,
                savedScopeWiderThanCurrentProject,
                onConfirm: async () => {
                  const result = await saveOverrides();
                  const status = reportSaveResults(result);

                  const succeededCategories = Array.from(
                    new Set(
                      result.results.filter((r) => r.ok).map((r) => r.category),
                    ),
                  );
                  if (succeededCategories.length > 0) {
                    // The server uses the cascade-aware resolver
                    // (PROJECT > TEAM > ORGANIZATION > platform default), so
                    // saving an org/team rule when the project already has a
                    // closer override applies the project's value, NOT the
                    // saved value. The server returns the value it actually
                    // used; we surface that in the toast so the user sees the
                    // truth (not the form value they typed).
                    const triggerResults = await Promise.all(
                      succeededCategories.map((category) =>
                        triggerUpdate
                          .mutateAsync({
                            projectId,
                            category,
                          })
                          .then(
                            (res) => ({
                              ok: true as const,
                              applied: res.appliedRetentionDays,
                            }),
                            (error: Error) => ({
                              ok: false as const,
                              error,
                            }),
                          ),
                      ),
                    );
                    const triggerFailed = triggerResults.filter((r) => !r.ok);
                    if (triggerFailed.length === 0) {
                      const appliedValues = Array.from(
                        new Set(
                          triggerResults
                            .filter(
                              (r): r is { ok: true; applied: number } => r.ok,
                            )
                            .map((r) => r.applied),
                        ),
                      );
                      const description =
                        appliedValues.length === 1
                          ? `Rewriting existing rows to ${formatDays(appliedValues[0]!)}.`
                          : `Rewriting existing rows per category (${appliedValues
                              .map(formatDays)
                              .join(", ")}).`;
                      toaster.create({
                        title: "Applying retention to existing data…",
                        description,
                        type: "info",
                      });
                    } else {
                      const firstError = triggerFailed.find(
                        (r): r is { ok: false; error: Error } => !r.ok,
                      );
                      toaster.create({
                        title: "Some retroactive updates failed",
                        description: firstError?.error.message,
                        type: "error",
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
          projectId={projectId}
          isRemoving={removeForScope.isLoading}
          onCancel={() => setRemoveTarget(null)}
          onConfirm={async () => {
            if (!removeTarget) return;
            await removeScopeGroup(removeTarget);
            setRemoveTarget(null);
          }}
        />

        <ApplyToExistingConfirmDialog
          pending={pendingConfirm}
          isApplying={triggerUpdate.isLoading || setForScope.isLoading}
          onCancel={() => setPendingConfirm(null)}
          onConfirm={async () => {
            if (!pendingConfirm) return;
            const fn = pendingConfirm.onConfirm;
            setPendingConfirm(null);
            await fn();
          }}
        />
      </VStack>
    </SettingsLayout>
  );
}
