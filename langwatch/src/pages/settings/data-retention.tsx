import {
  Alert,
  Badge,
  Button,
  Card,
  createListCollection,
  Field,
  Heading,
  HStack,
  Input,
  Progress,
  Spacer,
  Spinner,
  Table,
  Text,
  VStack,
} from "@chakra-ui/react";
import { Building2, Folder, Trash2, Users } from "lucide-react";
import { useEffect, useState } from "react";
import SettingsLayout from "~/components/SettingsLayout";
import {
  ScopeChipPicker,
  type ScopeChipPickerEntry,
  type ScopeChipPickerScopeType,
} from "~/components/settings/ScopeChipPicker";
import { ScopeFilter as ScopeFilterComponent } from "~/components/settings/ScopeFilter";
import { useAvailableScopes } from "~/hooks/useAvailableScopes";
import { useUrlScopeFilter } from "~/hooks/useUrlScopeFilter";
import {
  isScopeInFilter,
  resolveScopeFilter,
} from "~/utils/filterProvidersByScope";
import { Dialog } from "~/components/ui/dialog";
import { Drawer } from "~/components/ui/drawer";
import { Select } from "~/components/ui/select";
import { Switch } from "~/components/ui/switch";
import { toaster } from "~/components/ui/toaster";
import { withPermissionGuard } from "~/components/WithPermissionGuard";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import {
  DEFAULT_RETENTION_DAYS,
  MAX_RETENTION_DAYS,
  MIN_RETENTION_DAYS,
  RETENTION_CATEGORIES,
  RETENTION_WEEK_DAYS,
  type RetentionCategory,
} from "~/server/data-retention/retentionPolicy.schema";
import type { MutationProgress } from "~/server/data-retention/retroactive/retroactiveUpdate.service";
import { api } from "~/utils/api";

const CATEGORY_LABELS: Record<RetentionCategory, string> = {
  traces: "Traces & Spans",
  scenarios: "Scenarios",
  experiments: "Experiments",
};

const SCOPE_ICON: Record<ScopeChipPickerScopeType, typeof Building2> = {
  ORGANIZATION: Building2,
  TEAM: Users,
  PROJECT: Folder,
};

// Retention is always stored in days, but the picker speaks human time. All
// units round-trip through whole weeks so the resulting day count is always
// a valid 7-multiple — 1 month = 4 weeks (28 days), 1 year = 52 weeks (364
// days). This is the same calendar arithmetic ClickHouse partition pruning
// expects.
const DAYS_PER_UNIT = { weeks: 7, months: 28, years: 364 } as const;
type RetentionUnit = keyof typeof DAYS_PER_UNIT;

const RETENTION_UNIT_LABELS: Record<RetentionUnit, string> = {
  weeks: "weeks",
  months: "months",
  years: "years",
};

const retentionUnitCollection = createListCollection({
  items: (Object.keys(DAYS_PER_UNIT) as RetentionUnit[]).map((u) => ({
    value: u,
    label: RETENTION_UNIT_LABELS[u],
  })),
});

const RETENTION_PRESETS: Array<{ value: string; label: string; days: number }> =
  [
    { value: "49", label: "7 weeks", days: 49 },
    { value: "91", label: "3 months", days: 91 },
    { value: "182", label: "6 months", days: 182 },
    { value: "364", label: "1 year", days: 364 },
    { value: "728", label: "2 years", days: 728 },
    { value: "1820", label: "5 years", days: 1820 },
  ];

const CUSTOM_PRESET_VALUE = "custom";

const retentionPresetCollection = createListCollection({
  items: [
    ...RETENTION_PRESETS.map((p) => ({ value: p.value, label: p.label })),
    { value: CUSTOM_PRESET_VALUE, label: "Custom…" },
  ],
});

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  const value = bytes / Math.pow(1024, i);
  return `${value.toFixed(2)} ${units[i]}`;
}

function formatDays(days: number): string {
  return days === 0 ? "Indefinite" : `${days} days`;
}

type RetentionRuleRow = {
  scopeType: ScopeChipPickerScopeType;
  scopeId: string;
  name: string;
  category: RetentionCategory;
  retentionDays: number;
};

type RetentionScopeGroup = {
  scopeType: ScopeChipPickerScopeType;
  scopeId: string;
  name: string;
  byCategory: Partial<Record<RetentionCategory, number>>;
  rules: RetentionRuleRow[];
};

/** Groups override rows by (scopeType, scopeId), preserving first-seen order.
 *  We collapse the three category rows per scope into a single logical group
 *  so the Scope|Policy table renders one row per scope — categories almost
 *  always share the same value in practice. */
function groupRulesByScope(rules: RetentionRuleRow[]): RetentionScopeGroup[] {
  const groups: RetentionScopeGroup[] = [];
  const indexByKey = new Map<string, number>();
  for (const r of rules) {
    const key = `${r.scopeType}:${r.scopeId}`;
    const idx = indexByKey.get(key);
    if (idx === undefined) {
      indexByKey.set(key, groups.length);
      groups.push({
        scopeType: r.scopeType,
        scopeId: r.scopeId,
        name: r.name,
        byCategory: { [r.category]: r.retentionDays },
        rules: [r],
      });
    } else {
      const group = groups[idx]!;
      group.rules.push(r);
      group.byCategory[r.category] = r.retentionDays;
    }
  }
  return groups;
}

const SCOPE_TIER_ORDER: Record<ScopeChipPickerScopeType, number> = {
  ORGANIZATION: 0,
  TEAM: 1,
  PROJECT: 2,
};

/** Render a single Policy cell value. If all three categories share the same
 *  retention, show one number ("1820 days"). Otherwise show the per-category
 *  breakdown so a divergent legacy override is still legible. */
function renderPolicyValue(
  byCategory: Partial<Record<RetentionCategory, number>>,
): string {
  const present = RETENTION_CATEGORIES.filter(
    (c) => byCategory[c] !== undefined,
  );
  if (present.length === 0) return "—";
  const values = present.map((c) => byCategory[c]!);
  const allSame = values.every((v) => v === values[0]);
  if (allSame && present.length === RETENTION_CATEGORIES.length) {
    return formatDays(values[0]!);
  }
  return present
    .map((c) => `${CATEGORY_LABELS[c]}: ${formatDays(byCategory[c]!)}`)
    .join(" · ");
}

/** Top-line summary used in the Retention + Usage card. When all three
 *  categories share the same value we show that number; when they diverge
 *  the per-category rows below already carry the detail, so the summary
 *  collapses to "Mixed" instead of repeating the breakdown twice. */
function renderPolicySummary(
  byCategory: Partial<Record<RetentionCategory, number>>,
): string {
  const present = RETENTION_CATEGORIES.filter(
    (c) => byCategory[c] !== undefined,
  );
  if (present.length === 0) return "—";
  const values = present.map((c) => byCategory[c]!);
  const allSame = values.every((v) => v === values[0]);
  if (allSame && present.length === RETENTION_CATEGORIES.length) {
    return formatDays(values[0]!);
  }
  return "Mixed";
}

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
  const storageQuery = api.dataRetention.getStorageBreakdown.useQuery({
    projectId,
  });

  const [drawerOpen, setDrawerOpen] = useState(false);

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
    const categories = (Object.keys(group.byCategory) as RetentionCategory[])
      .filter((c) => group.byCategory[c] !== undefined);
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

  const resolved = resolveScopeFilter(scopeFilter, {
    currentTeamId: teamId,
    currentProjectId: projectId,
  });
  const filteredRules = (snapshot?.rules ?? []).filter((r) =>
    isScopeInFilter(
      { scopeType: r.scopeType, scopeId: r.scopeId },
      resolved,
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
                Your plan applies the platform default to every project.
                Upgrade to configure per-organization, per-team, or per-project
                retention overrides.
              </Alert.Description>
            </Alert.Content>
          </Alert.Root>
        )}

        {snapshot && snapshot.rules.length > 0 && scopeGroups.length === 0 ? (
          <Card.Root width="full">
            <Card.Body>
              <Text fontSize="sm" color="fg.muted" textAlign="center">
                No retention policies match the current scope filter.
              </Text>
            </Card.Body>
          </Card.Root>
        ) : snapshot && scopeGroups.length > 0 && (
          <Card.Root width="full" overflow="hidden">
            <Card.Body paddingY={0} paddingX={0}>
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
                      <Table.Row
                        key={`${group.scopeType}:${group.scopeId}`}
                      >
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
                            <Button
                              size="xs"
                              variant="ghost"
                              colorPalette="red"
                              loading={removeForScope.isLoading}
                              onClick={() => void removeScopeGroup(group)}
                              aria-label="Remove retention policy"
                            >
                              <Trash2 size={14} />
                            </Button>
                          )}
                        </Table.Cell>
                      </Table.Row>
                    );
                  })}
                </Table.Body>
              </Table.Root>
            </Card.Body>
          </Card.Root>
        )}

        <RetroactiveProgressCard
          mutations={activeMutations}
          onCancel={(mutationId) =>
            killMutation.mutate({ projectId, mutationId })
          }
          isCancelling={killMutation.isLoading}
        />

        {snapshot && (
          <RetentionAndUsageCard
            effective={snapshot.effective}
            isLoading={storageQuery.isLoading}
            data={storageQuery.data}
          />
        )}

        {available && (
          <AddOverrideDrawer
            open={drawerOpen}
            onClose={() => setDrawerOpen(false)}
            available={available}
            currentOrganizationId={organizationId}
            currentTeamId={teamId}
            currentProjectId={projectId}
            isSaving={
              setForScope.isLoading || triggerUpdate.isLoading
            }
            onSave={async (scopes, retentionDays, applyToExisting) => {
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
                if (status.success) setDrawerOpen(false);
                return;
              }

              setPendingConfirm({
                retentionDays,
                onConfirm: async () => {
                  const result = await saveOverrides();
                  const status = reportSaveResults(result);

                  const succeededCategories = Array.from(
                    new Set(
                      result.results
                        .filter((r) => r.ok)
                        .map((r) => r.category),
                    ),
                  );
                  if (succeededCategories.length > 0) {
                    const triggerResults = await Promise.all(
                      succeededCategories.map((category) =>
                        triggerUpdate
                          .mutateAsync({
                            projectId,
                            category,
                            newRetentionDays: retentionDays,
                          })
                          .then(
                            () => ({ ok: true as const }),
                            (error: Error) => ({
                              ok: false as const,
                              error,
                            }),
                          ),
                      ),
                    );
                    const triggerFailed = triggerResults.filter(
                      (r) => !r.ok,
                    );
                    if (triggerFailed.length === 0) {
                      toaster.create({
                        title: "Applying retention to existing data…",
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
                  if (status.success) setDrawerOpen(false);
                },
              });
            }}
          />
        )}

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

function RetroactiveProgressCard({
  mutations,
  onCancel,
  isCancelling,
}: {
  mutations: MutationProgress[];
  onCancel: (mutationId: string) => void;
  isCancelling: boolean;
}) {
  if (mutations.length === 0) return null;
  return (
    <Card.Root width="full">
      <Card.Header>
        <Heading as="h3" fontSize="lg">
          Applying retention to existing data
        </Heading>
        <Text fontSize="sm" color="fg.muted">
          ClickHouse rewrites the affected parts during background merges. Large
          datasets can take a while; the count below is parts still pending.
        </Text>
      </Card.Header>
      <Card.Body>
        <VStack gap={4} align="stretch">
          {mutations.map((m) => (
            <VStack key={m.mutationId} gap={1} align="stretch">
              <HStack justifyContent="space-between">
                <Text>
                  {m.table}
                  {m.category ? ` · ${CATEGORY_LABELS[m.category]}` : ""}
                </Text>
                <HStack gap={3}>
                  <Text fontSize="sm" color="fg.muted">
                    {m.partsToDo} parts remaining
                  </Text>
                  <Button
                    size="xs"
                    variant="ghost"
                    colorPalette="red"
                    loading={isCancelling}
                    onClick={() => onCancel(m.mutationId)}
                  >
                    Cancel
                  </Button>
                </HStack>
              </HStack>
              <Progress.Root value={null} size="xs" colorPalette="blue">
                <Progress.Track>
                  <Progress.Range />
                </Progress.Track>
              </Progress.Root>
            </VStack>
          ))}
        </VStack>
      </Card.Body>
    </Card.Root>
  );
}

function ApplyToExistingConfirmDialog({
  pending,
  isApplying,
  onCancel,
  onConfirm,
}: {
  pending: { retentionDays: number } | null;
  isApplying: boolean;
  onCancel: () => void;
  onConfirm: () => void | Promise<void>;
}) {
  return (
    <Dialog.Root
      open={!!pending}
      onOpenChange={({ open }) => {
        if (!open) onCancel();
      }}
    >
      <Dialog.Content>
        <Dialog.Header>
          <Dialog.Title>Apply retention to existing data?</Dialog.Title>
        </Dialog.Header>
        <Dialog.Body>
          {pending && (
            <Text>
              We will rewrite existing data to use {pending.retentionDays} days
              of retention. If any rows are currently older than{" "}
              {pending.retentionDays} days, they become eligible for deletion
              on the next background merge. After deletion, this cannot be
              undone.
            </Text>
          )}
        </Dialog.Body>
        <Dialog.Footer>
          <Button variant="outline" onClick={onCancel}>
            Cancel
          </Button>
          <Button
            colorPalette="red"
            loading={isApplying}
            onClick={() => void onConfirm()}
          >
            Apply to existing data
          </Button>
        </Dialog.Footer>
      </Dialog.Content>
    </Dialog.Root>
  );
}

function RetentionAndUsageCard({
  effective,
  isLoading,
  data,
}: {
  effective: Partial<Record<RetentionCategory, number>>;
  isLoading: boolean;
  data?: { totalBytes: number; byCategory: Record<RetentionCategory, number> };
}) {
  const summary = renderPolicySummary(effective);
  return (
    <Card.Root width="full">
      <Card.Header>
        <HStack width="full" justify="space-between" align="start">
          <VStack align="start" gap={0}>
            <Heading as="h3" fontSize="lg">
              Data Retention
            </Heading>
            <Text fontSize="sm" color="fg.muted">
              The retention currently applied to current project.
            </Text>
          </VStack>
          <Text fontWeight="bold" fontSize="lg" flexShrink={0}>
            {summary}
          </Text>
        </HStack>
      </Card.Header>
      <Card.Body>
        <VStack gap={5} align="stretch">
          {summary === "Mixed" && (
            <VStack gap={2} align="stretch">
              {RETENTION_CATEGORIES.map((category) => (
                <HStack key={category} justifyContent="space-between">
                  <Text color="fg.muted">{CATEGORY_LABELS[category]}</Text>
                  <Text>
                    {effective[category] !== undefined
                      ? formatDays(effective[category]!)
                      : "—"}
                  </Text>
                </HStack>
              ))}
            </VStack>
          )}
          <VStack gap={2} align="stretch">
            <VStack align="start" gap={0}>
              <Heading as="h3" fontSize="lg">
                Data Storage
              </Heading>
              <Text fontSize="sm" color="fg.muted">
                The storage that current project occupies today.
              </Text>
            </VStack>
            {isLoading ? (
              <Spinner />
            ) : data ? (
              <VStack gap={2} align="stretch" paddingTop={1}>
                <HStack justifyContent="space-between">
                  <Text fontWeight="semibold">Total stored</Text>
                  <Text fontWeight="bold">{formatBytes(data.totalBytes)}</Text>
                </HStack>
                {RETENTION_CATEGORIES.map((category) => (
                  <HStack key={category} justifyContent="space-between">
                    <Text color="fg.muted">{CATEGORY_LABELS[category]}</Text>
                    <Text>{formatBytes(data.byCategory[category])}</Text>
                  </HStack>
                ))}
              </VStack>
            ) : null}
          </VStack>
        </VStack>
      </Card.Body>
    </Card.Root>
  );
}

function AddOverrideDrawer({
  open,
  onClose,
  available,
  currentOrganizationId,
  currentTeamId,
  currentProjectId,
  isSaving,
  onSave,
}: {
  open: boolean;
  onClose: () => void;
  available: {
    organization: { id: string; name: string } | null;
    teams: { id: string; name: string }[];
    projects: { id: string; name: string; teamId: string }[];
  };
  currentOrganizationId: string | undefined;
  currentTeamId: string | undefined;
  currentProjectId: string;
  isSaving: boolean;
  onSave: (
    scopes: ScopeChipPickerEntry[],
    retentionDays: number,
    applyToExisting: boolean,
  ) => void;
}) {
  const [scopes, setScopes] = useState<ScopeChipPickerEntry[]>([]);
  const [preset, setPreset] = useState<string>(String(DEFAULT_RETENTION_DAYS));
  const [customAmount, setCustomAmount] = useState<string>("");
  const [customUnit, setCustomUnit] = useState<RetentionUnit>("weeks");
  const [applyToExisting, setApplyToExisting] = useState<boolean>(true);

  useEffect(() => {
    if (open) {
      // Default to the current project so the picker opens on the user's
      // working scope, mirroring the API-key drawer pattern.
      setScopes(
        available.projects.some((p) => p.id === currentProjectId)
          ? [{ scopeType: "PROJECT", scopeId: currentProjectId }]
          : [],
      );
      setPreset(String(DEFAULT_RETENTION_DAYS));
      setCustomAmount("");
      setCustomUnit("weeks");
      setApplyToExisting(true);
    }
  }, [open, currentProjectId, available.projects]);

  const resolvedDays = (() => {
    if (preset === CUSTOM_PRESET_VALUE) {
      const n = Number(customAmount);
      if (!Number.isFinite(n) || !Number.isInteger(n) || n <= 0) return NaN;
      return n * DAYS_PER_UNIT[customUnit];
    }
    return Number(preset);
  })();

  const daysValid =
    Number.isFinite(resolvedDays) &&
    Number.isInteger(resolvedDays) &&
    resolvedDays >= MIN_RETENTION_DAYS &&
    resolvedDays <= MAX_RETENTION_DAYS &&
    resolvedDays % RETENTION_WEEK_DAYS === 0;

  const canSave = scopes.length > 0 && daysValid && !isSaving;

  return (
    <Drawer.Root
      placement="end"
      size="md"
      open={open}
      onOpenChange={({ open: isOpen }) => {
        if (!isOpen) onClose();
      }}
    >
      <Drawer.Content bg="bg">
        <Drawer.Header>
          <Heading size="md">Add retention policy</Heading>
          <Drawer.CloseTrigger />
        </Drawer.Header>
        <Drawer.Body>
          <VStack gap={5} align="stretch">
            <VStack gap={1.5} align="start" width="full">
              <Text fontWeight="600" fontSize="sm">
                Scope
              </Text>
              <ScopeChipPicker
                value={scopes}
                onChange={setScopes}
                organizationId={available.organization?.id}
                organizationName={available.organization?.name}
                availableTeams={available.teams}
                availableProjects={available.projects}
                label=""
                currentOrganizationId={
                  available.organization ? currentOrganizationId : undefined
                }
                currentTeamId={currentTeamId}
                currentProjectId={currentProjectId}
              />
            </VStack>

            <Field.Root>
              <Field.Label>Retention</Field.Label>
              <Select.Root
                collection={retentionPresetCollection}
                value={[preset]}
                onValueChange={(details) => {
                  const v = details.value[0];
                  if (v) setPreset(v);
                }}
              >
                <Select.Trigger background="bg">
                  <Select.ValueText placeholder="Pick a retention" />
                </Select.Trigger>
                <Select.Content>
                  {retentionPresetCollection.items.map((item) => (
                    <Select.Item key={item.value} item={item}>
                      {item.label}
                    </Select.Item>
                  ))}
                </Select.Content>
              </Select.Root>
              {preset === CUSTOM_PRESET_VALUE && (
                <HStack gap={2} marginTop={2} align="start">
                  <Input
                    type="number"
                    min={1}
                    value={customAmount}
                    onChange={(e) => setCustomAmount(e.target.value)}
                    width="120px"
                    placeholder="e.g. 8"
                  />
                  <Select.Root
                    collection={retentionUnitCollection}
                    value={[customUnit]}
                    onValueChange={(details) => {
                      const v = details.value[0] as RetentionUnit | undefined;
                      if (v) setCustomUnit(v);
                    }}
                  >
                    <Select.Trigger background="bg" width="140px">
                      <Select.ValueText />
                    </Select.Trigger>
                    <Select.Content>
                      {retentionUnitCollection.items.map((item) => (
                        <Select.Item key={item.value} item={item}>
                          {item.label}
                        </Select.Item>
                      ))}
                    </Select.Content>
                  </Select.Root>
                </HStack>
              )}
              <Field.HelperText>
                {preset === CUSTOM_PRESET_VALUE && customAmount && daysValid
                  ? `Stored as ${resolvedDays} days.`
                  : preset === CUSTOM_PRESET_VALUE && customAmount && !daysValid
                    ? `Must be between ${MIN_RETENTION_DAYS} and ${MAX_RETENTION_DAYS} days.`
                    : `Minimum ${MIN_RETENTION_DAYS} days (7 weeks). Retention is partition-aligned and rounded to whole weeks under the hood.`}
              </Field.HelperText>
            </Field.Root>

            <HStack gap={3} align="start">
              <Switch
                checked={applyToExisting}
                onCheckedChange={({ checked }) =>
                  setApplyToExisting(checked === true)
                }
              />
              <VStack align="start" gap={0}>
                <Text fontWeight="600" fontSize="sm">
                  Apply this change to existing data
                </Text>
                <Text fontSize="xs" color="fg.muted">
                  Rewrites this project's existing rows so the new retention
                  takes effect immediately, not just for new ingestion.
                </Text>
              </VStack>
            </HStack>
          </VStack>
        </Drawer.Body>
        <Drawer.Footer>
          <HStack width="full" justify="end" gap={2}>
            <Button variant="outline" onClick={onClose} disabled={isSaving}>
              Cancel
            </Button>
            <Button
              colorPalette="blue"
              disabled={!canSave}
              loading={isSaving}
              onClick={() => onSave(scopes, resolvedDays, applyToExisting)}
            >
              Create
            </Button>
          </HStack>
        </Drawer.Footer>
      </Drawer.Content>
    </Drawer.Root>
  );
}
