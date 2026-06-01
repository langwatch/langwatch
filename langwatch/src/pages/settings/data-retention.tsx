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
  Spinner,
  Table,
  Text,
  VStack,
} from "@chakra-ui/react";
import { Building2, Folder, History, Trash2, Users } from "lucide-react";
import { useEffect, useState } from "react";
import SettingsLayout from "~/components/SettingsLayout";
import {
  ScopeChipPicker,
  type ScopeChipPickerEntry,
  type ScopeChipPickerScopeType,
} from "~/components/settings/ScopeChipPicker";
import { Dialog } from "~/components/ui/dialog";
import { Drawer } from "~/components/ui/drawer";
import { Select } from "~/components/ui/select";
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
import { classifyRetentionChange } from "~/server/data-retention/retroactive/retroactiveApply";
import type { MutationProgress } from "~/server/data-retention/retroactive/retroactiveUpdate.service";
import { api } from "~/utils/api";

const CATEGORY_LABELS: Record<RetentionCategory, string> = {
  traces: "Traces & Spans",
  scenarios: "Scenarios",
  experiments: "Experiments",
};

// Each category covers several ClickHouse tables. Surface the coverage so the
// page doesn't read as "only 3 things are retained" when the underlying
// stamping reaches 11 tables.
const CATEGORY_COVERAGE: Record<RetentionCategory, string> = {
  traces: "Spans, logs, metrics, summaries, evaluations and DSPy steps.",
  scenarios: "Simulation runs and suite runs.",
  experiments: "Experiment runs and run items.",
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

const ALL_CATEGORIES_VALUE = "__all__";
type CategoryPick = typeof ALL_CATEGORIES_VALUE | RetentionCategory;

// One Select with "All categories" pinned at the top followed by each
// individual category. Two ItemGroups render a visual divider between the
// shortcut and the specific picks without us having to inject a separator.
const categoryPickCollection = createListCollection({
  items: [
    { value: ALL_CATEGORIES_VALUE, label: "All categories" },
    ...RETENTION_CATEGORIES.map((c) => ({
      value: c,
      label: CATEGORY_LABELS[c],
    })),
  ],
});

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

function DataRetentionSettings() {
  const { project, organization, team } = useOrganizationTeamProject();
  if (!project) return null;
  return (
    <DataRetentionPage
      projectId={project.id}
      organizationId={organization?.id}
      teamId={team?.id}
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
}: {
  projectId: string;
  organizationId: string | undefined;
  teamId: string | undefined;
}) {
  const utils = api.useUtils();
  const rulesQuery = api.dataRetention.getRules.useQuery({ projectId });
  const storageQuery = api.dataRetention.getStorageBreakdown.useQuery({
    projectId,
  });

  const [drawerOpen, setDrawerOpen] = useState(false);

  const invalidate = () =>
    utils.dataRetention.getRules.invalidate({ projectId });

  // Per-call toasts are intentionally omitted — the Add-override drawer
  // fans out one setForScope per (scope × category) pair and stacks the
  // toaster column with identical "saved" messages. The drawer's onSave
  // emits a single aggregated toast after the batch resolves.
  const setForScope = api.dataRetention.setForScope.useMutation();

  const removeForScope = api.dataRetention.removeForScope.useMutation({
    onSuccess: () => {
      void invalidate();
      toaster.create({ title: "Override removed", type: "success" });
    },
    onError: (error) =>
      toaster.create({
        title: "Failed to remove override",
        description: error.message,
        type: "error",
      }),
  });

  // Retroactive apply: stamp the project's EXISTING ClickHouse rows with the
  // effective retention. `baseline` approximates what existing data currently
  // carries — the effective policy as first seen this session — so we can warn
  // before a contraction makes old data deletable. It's captured before any
  // edit and advanced only after a successful apply; the precise per-row value
  // isn't queried, which a change-then-apply workflow keeps in sync.
  const [baseline, setBaseline] = useState<Record<
    RetentionCategory,
    number
  > | null>(null);
  useEffect(() => {
    if (rulesQuery.data && baseline === null) {
      setBaseline(rulesQuery.data.effective);
    }
  }, [rulesQuery.data, baseline]);

  const [confirmContraction, setConfirmContraction] = useState<{
    category: RetentionCategory;
    from: number;
    to: number;
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

  const triggerUpdate = api.dataRetention.triggerRetroactiveUpdate.useMutation({
    onSuccess: (_data, variables) => {
      setBaseline((b) =>
        b ? { ...b, [variables.category]: variables.newRetentionDays } : b,
      );
      setPollMs(3000);
      void progressQuery.refetch();
      toaster.create({
        title: "Applying retention to existing data…",
        type: "info",
      });
    },
    onError: (error) =>
      toaster.create({
        title: "Failed to apply retention to existing data",
        description: error.message,
        type: "error",
      }),
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

  const applyToExistingData = (category: RetentionCategory) => {
    const to = rulesQuery.data?.effective[category] ?? 0;
    if (to <= 0) return; // indefinite — nothing finite to propagate
    const from = baseline?.[category] ?? to;
    const kind = classifyRetentionChange({ current: from, next: to });
    if (kind === "noop") {
      toaster.create({
        title: "Existing data already uses this retention",
        type: "info",
      });
      return;
    }
    if (kind === "contraction") {
      setConfirmContraction({ category, from, to });
      return;
    }
    // Expansion is safe — no data becomes deletable. Apply immediately.
    triggerUpdate.mutate({ projectId, category, newRetentionDays: to });
  };

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

  // Show "Apply to existing data" only when the effective value diverges from
  // the baseline this session opened with. Once applied, baseline catches up
  // and the row goes quiet again — no perpetual call-to-action.
  const hasPendingApply = (category: RetentionCategory): boolean => {
    if (!snapshot || !baseline) return false;
    const to = snapshot.effective[category];
    if (to <= 0) return false;
    return baseline[category] !== to;
  };

  return (
    <SettingsLayout>
      <VStack gap={6} width="full" align="start" paddingX={6} paddingY={4}>
        <Heading as="h2" fontSize="xl" marginTop={2}>
          Data Retention
        </Heading>

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

        <Card.Root width="full">
          <Card.Header>
            <Heading as="h3" fontSize="lg">
              Effective Retention
            </Heading>
            <Text fontSize="sm" color="fg.muted">
              What applies to this project today, after the project → team →
              organization cascade. No override anywhere means the platform
              default applies.
            </Text>
          </Card.Header>
          <Card.Body>
            <VStack gap={4} align="stretch">
              {RETENTION_CATEGORIES.map((category) => {
                const days = snapshot?.effective[category] ?? 0;
                const showApply =
                  canWrite && projectIsWritable && hasPendingApply(category);
                return (
                  <HStack
                    key={category}
                    justifyContent="space-between"
                    align="start"
                  >
                    <VStack align="start" gap={0}>
                      <Text>{CATEGORY_LABELS[category]}</Text>
                      <Text fontSize="xs" color="fg.muted">
                        {CATEGORY_COVERAGE[category]}
                      </Text>
                    </VStack>
                    <HStack gap={3} flexShrink={0}>
                      <Text fontWeight="medium">{formatDays(days)}</Text>
                      {showApply && (
                        <Button
                          size="xs"
                          variant="outline"
                          loading={
                            triggerUpdate.isLoading &&
                            triggerUpdate.variables?.category === category
                          }
                          onClick={() => applyToExistingData(category)}
                        >
                          <History size={14} />
                          Apply to existing data
                        </Button>
                      )}
                    </HStack>
                  </HStack>
                );
              })}
            </VStack>
          </Card.Body>
        </Card.Root>

        {canConfigureRetention && snapshot && (
          <Card.Root width="full">
            <Card.Header>
              <HStack justifyContent="space-between" width="full">
                <VStack align="start" gap={0}>
                  <Heading as="h3" fontSize="lg">
                    Overrides
                  </Heading>
                  <Text fontSize="sm" color="fg.muted">
                    Set a retention for a category at the organization, a team,
                    or a project. The most specific override wins. Retention is
                    set in whole weeks (multiples of {RETENTION_WEEK_DAYS}{" "}
                    days); minimum {MIN_RETENTION_DAYS} days.
                  </Text>
                </VStack>
                {canWrite && (
                  <Button
                    colorPalette="blue"
                    onClick={() => setDrawerOpen(true)}
                    flexShrink={0}
                  >
                    Add override
                  </Button>
                )}
              </HStack>
            </Card.Header>
            <Card.Body>
              {snapshot.rules.length > 0 ? (
                <Table.Root size="sm">
                  <Table.Header>
                    <Table.Row>
                      <Table.ColumnHeader>Scope</Table.ColumnHeader>
                      <Table.ColumnHeader>Category</Table.ColumnHeader>
                      <Table.ColumnHeader>Retention</Table.ColumnHeader>
                      <Table.ColumnHeader />
                    </Table.Row>
                  </Table.Header>
                  <Table.Body>
                    {snapshot.rules.map((rule) => {
                      const Icon = SCOPE_ICON[rule.scopeType];
                      return (
                        <Table.Row
                          key={`${rule.scopeType}:${rule.scopeId}:${rule.category}`}
                        >
                          <Table.Cell>
                            <HStack gap={2}>
                              <Icon size={14} />
                              <Text>{rule.name}</Text>
                              <Badge size="sm" colorPalette="gray">
                                {rule.scopeType.toLowerCase()}
                              </Badge>
                            </HStack>
                          </Table.Cell>
                          <Table.Cell>
                            {CATEGORY_LABELS[rule.category]}
                          </Table.Cell>
                          <Table.Cell>
                            {formatDays(rule.retentionDays)}
                          </Table.Cell>
                          <Table.Cell textAlign="end">
                            {canWrite && (
                              <Button
                                size="xs"
                                variant="ghost"
                                colorPalette="red"
                                loading={removeForScope.isLoading}
                                onClick={() =>
                                  removeForScope.mutate({
                                    projectId,
                                    scope: {
                                      scopeType: rule.scopeType,
                                      scopeId: rule.scopeId,
                                    },
                                    category: rule.category,
                                  })
                                }
                                aria-label="Remove override"
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
              ) : (
                <Text fontSize="sm" color="fg.muted">
                  No overrides yet — the platform default applies.
                </Text>
              )}
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

        <StorageUsageCard
          isLoading={storageQuery.isLoading}
          data={storageQuery.data}
        />

        {available && (
          <AddOverrideDrawer
            open={drawerOpen}
            onClose={() => setDrawerOpen(false)}
            available={available}
            currentOrganizationId={organizationId}
            currentTeamId={teamId}
            currentProjectId={projectId}
            isSaving={setForScope.isLoading}
            onSave={async (scopes, categories, retentionDays) => {
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
                    pairs.length === 1
                      ? "Retention override saved"
                      : `${pairs.length} retention overrides saved`,
                  type: "success",
                });
                setDrawerOpen(false);
                return;
              }
              const firstError = failed.find(
                (r): r is { ok: false; error: Error } => !r.ok,
              );
              toaster.create({
                title:
                  failed.length === pairs.length
                    ? "Failed to save overrides"
                    : `Saved ${pairs.length - failed.length} of ${pairs.length} overrides`,
                description: firstError?.error.message,
                type: "error",
              });
            }}
          />
        )}

        <ContractionConfirmDialog
          pending={confirmContraction}
          isApplying={triggerUpdate.isLoading}
          onCancel={() => setConfirmContraction(null)}
          onConfirm={() => {
            if (!confirmContraction) return;
            triggerUpdate.mutate({
              projectId,
              category: confirmContraction.category,
              newRetentionDays: confirmContraction.to,
            });
            setConfirmContraction(null);
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

function ContractionConfirmDialog({
  pending,
  isApplying,
  onCancel,
  onConfirm,
}: {
  pending: { category: RetentionCategory; from: number; to: number } | null;
  isApplying: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const fromLabel =
    pending && pending.from > 0 ? `${pending.from} days` : "indefinitely";
  return (
    <Dialog.Root
      open={!!pending}
      onOpenChange={({ open }) => {
        if (!open) onCancel();
      }}
    >
      <Dialog.Content>
        <Dialog.Header>
          <Dialog.Title>Apply shorter retention to existing data?</Dialog.Title>
        </Dialog.Header>
        <Dialog.Body>
          {pending && (
            <Text>
              {CATEGORY_LABELS[pending.category]} data is currently kept{" "}
              {fromLabel}. Applying {pending.to} days to existing data will make
              everything older than {pending.to} days eligible for deletion on
              the next ClickHouse merge. This cannot be undone.
            </Text>
          )}
        </Dialog.Body>
        <Dialog.Footer>
          <Button variant="outline" onClick={onCancel}>
            Cancel
          </Button>
          <Button colorPalette="red" loading={isApplying} onClick={onConfirm}>
            Apply to existing data
          </Button>
        </Dialog.Footer>
      </Dialog.Content>
    </Dialog.Root>
  );
}

function StorageUsageCard({
  isLoading,
  data,
}: {
  isLoading: boolean;
  data?: { totalBytes: number; byCategory: Record<RetentionCategory, number> };
}) {
  return (
    <Card.Root width="full">
      <Card.Header>
        <Heading as="h3" fontSize="lg">
          Storage Usage
        </Heading>
        <Text fontSize="sm" color="fg.muted">
          Current stored data size for this project.
        </Text>
      </Card.Header>
      <Card.Body>
        {isLoading ? (
          <Spinner />
        ) : data ? (
          <VStack gap={3} align="stretch">
            <HStack justifyContent="space-between">
              <Text fontWeight="semibold">Total</Text>
              <Text fontWeight="bold" fontSize="lg">
                {formatBytes(data.totalBytes)}
              </Text>
            </HStack>
            {RETENTION_CATEGORIES.map((category) => (
              <HStack key={category} justifyContent="space-between">
                <Text color="fg.muted">{CATEGORY_LABELS[category]}</Text>
                <Text>{formatBytes(data.byCategory[category])}</Text>
              </HStack>
            ))}
          </VStack>
        ) : null}
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
    categories: RetentionCategory[],
    retentionDays: number,
  ) => void;
}) {
  const [scopes, setScopes] = useState<ScopeChipPickerEntry[]>([]);
  const [categoryPick, setCategoryPick] = useState<CategoryPick>(
    ALL_CATEGORIES_VALUE,
  );
  const [preset, setPreset] = useState<string>(
    String(DEFAULT_RETENTION_DAYS),
  );
  const [customAmount, setCustomAmount] = useState<string>("");
  const [customUnit, setCustomUnit] = useState<RetentionUnit>("weeks");

  useEffect(() => {
    if (open) {
      // Default to the current project so the picker opens on the user's
      // working scope, mirroring the API-key drawer pattern.
      setScopes(
        available.projects.some((p) => p.id === currentProjectId)
          ? [{ scopeType: "PROJECT", scopeId: currentProjectId }]
          : [],
      );
      setCategoryPick(ALL_CATEGORIES_VALUE);
      setPreset(String(DEFAULT_RETENTION_DAYS));
      setCustomAmount("");
      setCustomUnit("weeks");
    }
  }, [open, currentProjectId, available.projects]);

  const categories: RetentionCategory[] =
    categoryPick === ALL_CATEGORIES_VALUE
      ? [...RETENTION_CATEGORIES]
      : [categoryPick];

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
          <Heading size="md">Add retention override</Heading>
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
                showQuickPicks
                currentOrganizationId={
                  available.organization ? currentOrganizationId : undefined
                }
                currentTeamId={currentTeamId}
                currentProjectId={currentProjectId}
              />
            </VStack>

            <Field.Root>
              <Field.Label>Category</Field.Label>
              <Select.Root
                collection={categoryPickCollection}
                value={[categoryPick]}
                onValueChange={(details) => {
                  const v = details.value[0] as CategoryPick | undefined;
                  if (v) setCategoryPick(v);
                }}
              >
                <Select.Trigger background="bg">
                  <Select.ValueText placeholder="Select category" />
                </Select.Trigger>
                <Select.Content>
                  <Select.ItemGroup label="">
                    <Select.Item
                      item={categoryPickCollection.items[0]!}
                      key={ALL_CATEGORIES_VALUE}
                    >
                      All categories
                    </Select.Item>
                  </Select.ItemGroup>
                  <Select.ItemGroup label="">
                    {RETENTION_CATEGORIES.map((c, i) => (
                      <Select.Item
                        key={c}
                        item={categoryPickCollection.items[i + 1]!}
                      >
                        {CATEGORY_LABELS[c]}
                      </Select.Item>
                    ))}
                  </Select.ItemGroup>
                </Select.Content>
              </Select.Root>
              <Field.HelperText>
                {categoryPick === ALL_CATEGORIES_VALUE
                  ? "Creates one override per category at each picked scope."
                  : "You can add another override afterwards for a different category."}
              </Field.HelperText>
            </Field.Root>

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
          </VStack>
        </Drawer.Body>
        <Drawer.Footer>
          <HStack width="full" justify="end" gap={2}>
            <Button variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button
              colorPalette="blue"
              disabled={!canSave}
              loading={isSaving}
              onClick={() => onSave(scopes, categories, resolvedDays)}
            >
              Save
            </Button>
          </HStack>
        </Drawer.Footer>
      </Drawer.Content>
    </Drawer.Root>
  );
}
