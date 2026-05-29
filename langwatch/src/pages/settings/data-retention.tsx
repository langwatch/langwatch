import {
  Badge,
  Button,
  Card,
  Field,
  Heading,
  HStack,
  Input,
  Spinner,
  Table,
  Text,
  VStack,
} from "@chakra-ui/react";
import { Building2, Folder, Trash2, Users } from "lucide-react";
import { useState } from "react";
import {
  ScopeChipPicker,
  type ScopeChipPickerEntry,
  type ScopeChipPickerScopeType,
} from "~/components/settings/ScopeChipPicker";
import SettingsLayout from "~/components/SettingsLayout";
import { Dialog } from "~/components/ui/dialog";
import { toaster } from "~/components/ui/toaster";
import { withPermissionGuard } from "~/components/WithPermissionGuard";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import {
  MIN_RETENTION_DAYS,
  RETENTION_CATEGORIES,
  type RetentionCategory,
} from "~/server/data-retention/retentionPolicy.schema";
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
            What applies to this project today, after the
            project → team → organization cascade. No override anywhere means
            data is kept indefinitely.
          </Text>
        </Card.Header>
        <Card.Body>
          <VStack gap={3} align="stretch">
            {RETENTION_CATEGORIES.map((category) => (
              <HStack key={category} justifyContent="space-between">
                <Text color="fg.muted">{CATEGORY_LABELS[category]}</Text>
                <Text fontWeight="medium">
                  {formatDays(snapshot?.effective[category] ?? 0)}
                </Text>
              </HStack>
            ))}
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
                project. The most specific override wins. Minimum{" "}
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
    </VStack>
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
  const [days, setDays] = useState<string>(String(MIN_RETENTION_DAYS));

  const organizationId = available.organization?.id;
  const scope = scopes[scopes.length - 1];
  const daysNum = Number(days);
  const daysValid = Number.isInteger(daysNum) && daysNum >= MIN_RETENTION_DAYS;
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
                value={days}
                onChange={(e) => setDays(e.target.value)}
                width="200px"
              />
              {days !== "" && !daysValid && (
                <Field.ErrorText>
                  Minimum {MIN_RETENTION_DAYS} days
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
