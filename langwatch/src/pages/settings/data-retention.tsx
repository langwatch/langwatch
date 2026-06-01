import {
  Badge,
  Button,
  Card,
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

const SCOPE_ICON: Record<ScopeChipPickerScopeType, typeof Building2> = {
  ORGANIZATION: Building2,
  TEAM: Users,
  PROJECT: Folder,
};

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
  const { project } = useOrganizationTeamProject();
  if (!project) return null;
  return <DataRetentionPage projectId={project.id} />;
}

export default withPermissionGuard("project:view", {
  layoutComponent: SettingsLayout,
})(DataRetentionSettings);

function DataRetentionPage({ projectId }: { projectId: string }) {
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
      <VStack width="full" padding={8}>
        <Spinner />
      </VStack>
    );
  }

  const snapshot = rulesQuery.data;
  const available = snapshot?.available;
  const canWrite =
    !!available &&
    (!!available.organization ||
      available.teams.length > 0 ||
      available.projects.length > 0);

  return (
    <VStack gap={6} width="full" align="start" paddingX={6} paddingY={4}>
      <Heading as="h2" fontSize="xl" marginTop={2}>
        Data Retention
      </Heading>

      <Card.Root width="full">
        <Card.Header>
          <Heading as="h3" fontSize="lg">
            Effective Retention
          </Heading>
          <Text fontSize="sm" color="fg.muted">
            What applies to this project today, after the project → team →
            organization cascade. No override anywhere means data is kept
            indefinitely.
          </Text>
        </Card.Header>
        <Card.Body>
          <VStack gap={3} align="stretch">
            {RETENTION_CATEGORIES.map((category) => {
              const days = snapshot?.effective[category] ?? 0;
              return (
                <HStack key={category} justifyContent="space-between">
                  <Text color="fg.muted">{CATEGORY_LABELS[category]}</Text>
                  <HStack gap={3}>
                    <Text fontWeight="medium">{formatDays(days)}</Text>
                    {projectIsWritable && days > 0 && (
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

      <Card.Root width="full">
        <Card.Header>
          <HStack justifyContent="space-between" width="full">
            <VStack align="start" gap={0}>
              <Heading as="h3" fontSize="lg">
                Overrides
              </Heading>
              <Text fontSize="sm" color="fg.muted">
                Set a retention for a category at the organization, a team, or a
                project. The most specific override wins. Retention is set in
                whole weeks (multiples of {RETENTION_WEEK_DAYS} days); minimum{" "}
                {MIN_RETENTION_DAYS} days.
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
          {snapshot && snapshot.rules.length > 0 ? (
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
                      <Table.Cell>{CATEGORY_LABELS[rule.category]}</Table.Cell>
                      <Table.Cell>{formatDays(rule.retentionDays)}</Table.Cell>
                      <Table.Cell textAlign="end">
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
                      </Table.Cell>
                    </Table.Row>
                  );
                })}
              </Table.Body>
            </Table.Root>
          ) : (
            <Text fontSize="sm" color="fg.muted">
              No overrides yet — data is kept indefinitely.
            </Text>
          )}
        </Card.Body>
      </Card.Root>

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
          projectId={projectId}
          available={available}
          isSaving={setForScope.isLoading}
          onSave={(scope, category, retentionDays) =>
            setForScope.mutate(
              { projectId, scope, category, retentionDays },
              { onSuccess: () => setDrawerOpen(false) },
            )
          }
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
  isSaving,
  onSave,
}: {
  open: boolean;
  onClose: () => void;
  projectId: string;
  available: {
    organization: { id: string; name: string } | null;
    teams: { id: string; name: string }[];
    projects: { id: string; name: string; teamId: string }[];
  };
  isSaving: boolean;
  onSave: (
    scope: ScopeChipPickerEntry,
    category: RetentionCategory,
    retentionDays: number,
  ) => void;
}) {
  const [scopes, setScopes] = useState<ScopeChipPickerEntry[]>([]);
  const [category, setCategory] = useState<RetentionCategory>("traces");
  const [days, setDays] = useState<string>(String(DEFAULT_RETENTION_DAYS));

  const organizationId = available.organization?.id;
  const scope = scopes[scopes.length - 1];
  const daysNum = Number(days);
  const daysValid =
    Number.isInteger(daysNum) &&
    daysNum >= MIN_RETENTION_DAYS &&
    daysNum <= MAX_RETENTION_DAYS &&
    daysNum % RETENTION_WEEK_DAYS === 0;
  const canSave = !!scope && daysValid;

  return (
    <Dialog.Root
      open={open}
      onOpenChange={({ open: isOpen }) => {
        if (!isOpen) onClose();
      }}
    >
      <Dialog.Content>
        <Dialog.Header>
          <Dialog.Title>Add retention override</Dialog.Title>
        </Dialog.Header>
        <Dialog.Body>
          <VStack gap={4} align="stretch">
            <ScopeChipPicker
              value={scope ? [scope] : []}
              onChange={(next) => setScopes(next.slice(-1))}
              organizationId={organizationId}
              organizationName={available.organization?.name}
              availableTeams={available.teams}
              availableProjects={available.projects}
              showSummary
            />

            <Field.Root>
              <Field.Label>Category</Field.Label>
              <select
                value={category}
                onChange={(e) =>
                  setCategory(e.target.value as RetentionCategory)
                }
                style={{ padding: "6px 8px", borderRadius: 6 }}
              >
                {RETENTION_CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {CATEGORY_LABELS[c]}
                  </option>
                ))}
              </select>
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
              {days !== "" && !daysValid && (
                <Field.ErrorText>
                  Whole weeks only (multiples of {RETENTION_WEEK_DAYS} days),
                  between {MIN_RETENTION_DAYS} and {MAX_RETENTION_DAYS} days
                </Field.ErrorText>
              )}
            </Field.Root>
          </VStack>
        </Dialog.Body>
        <Dialog.Footer>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            colorPalette="blue"
            disabled={!canSave}
            loading={isSaving}
            onClick={() => scope && onSave(scope, category, daysNum)}
          >
            Save
          </Button>
        </Dialog.Footer>
      </Dialog.Content>
    </Dialog.Root>
  );
}
