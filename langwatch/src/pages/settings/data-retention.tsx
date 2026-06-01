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

const categoryCollection = createListCollection({
  items: RETENTION_CATEGORIES.map((c) => ({
    value: c,
    label: CATEGORY_LABELS[c],
  })),
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

  const setForScope = api.dataRetention.setForScope.useMutation({
    onSuccess: () => {
      void invalidate();
      toaster.create({ title: "Retention override saved", type: "success" });
    },
    onError: (error) =>
      toaster.create({
        title: "Failed to save override",
        description: error.message,
        type: "error",
      }),
  });

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
            onSave={async (scopes, category, retentionDays) => {
              const results = await Promise.all(
                scopes.map((scope) =>
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
              if (results.every((r) => r.ok)) setDrawerOpen(false);
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
    category: RetentionCategory,
    retentionDays: number,
  ) => void;
}) {
  const [scopes, setScopes] = useState<ScopeChipPickerEntry[]>([]);
  const [category, setCategory] = useState<RetentionCategory>("traces");
  const [days, setDays] = useState<string>(String(DEFAULT_RETENTION_DAYS));

  useEffect(() => {
    if (open) {
      // Default to the current project so the picker opens on the user's
      // working scope, mirroring the API-key drawer pattern.
      setScopes(
        available.projects.some((p) => p.id === currentProjectId)
          ? [{ scopeType: "PROJECT", scopeId: currentProjectId }]
          : [],
      );
      setCategory("traces");
      setDays(String(DEFAULT_RETENTION_DAYS));
    }
  }, [open, currentProjectId, available.projects]);

  const daysNum = Number(days);
  const daysValid =
    Number.isInteger(daysNum) &&
    daysNum >= MIN_RETENTION_DAYS &&
    daysNum <= MAX_RETENTION_DAYS &&
    daysNum % RETENTION_WEEK_DAYS === 0;
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
                collection={categoryCollection}
                value={[category]}
                onValueChange={(details) => {
                  const v = details.value[0];
                  if (v) setCategory(v as RetentionCategory);
                }}
              >
                <Select.Trigger background="bg">
                  <Select.ValueText placeholder="Select category" />
                </Select.Trigger>
                <Select.Content>
                  {categoryCollection.items.map((item) => (
                    <Select.Item key={item.value} item={item}>
                      {item.label}
                    </Select.Item>
                  ))}
                </Select.Content>
              </Select.Root>
            </Field.Root>

            <Field.Root invalid={days !== "" && !daysValid}>
              <Field.Label>Retention (days)</Field.Label>
              <Input
                type="number"
                min={MIN_RETENTION_DAYS}
                max={MAX_RETENTION_DAYS}
                step={RETENTION_WEEK_DAYS}
                value={days}
                onChange={(e) => setDays(e.target.value)}
                width="200px"
              />
              <Field.HelperText>
                Whole weeks only (multiples of {RETENTION_WEEK_DAYS} days),
                between {MIN_RETENTION_DAYS} and {MAX_RETENTION_DAYS} days.
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
              onClick={() => onSave(scopes, category, daysNum)}
            >
              Save
            </Button>
          </HStack>
        </Drawer.Footer>
      </Drawer.Content>
    </Drawer.Root>
  );
}
