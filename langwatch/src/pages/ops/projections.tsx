import { useEffect, useState } from "react";
import { useRouter } from "next/router";
import {
  Badge,
  Box,
  Button,
  Card,
  Center,
  DatePicker,
  EmptyState,
  HStack,
  Input,
  Portal,
  Spinner,
  Stat,
  Status,
  Table,
  TagsInput,
  Text,
  Textarea,
  VStack,
} from "@chakra-ui/react";
import { ArrowRight, Calendar, Search } from "lucide-react";
import { DashboardLayout } from "~/components/DashboardLayout";
import { PageLayout } from "~/components/ui/layouts/PageLayout";
import { Checkbox } from "~/components/ui/checkbox";
import { api } from "~/utils/api";
import { useOpsPermission } from "~/hooks/useOpsPermission";
import { toaster } from "~/components/ui/toaster";
import { ReplayProgressDrawer } from "~/components/ops/ReplayProgressDrawer";

function ReplayStatusBanner() {
  const router = useRouter();
  const statusQuery = api.ops.getReplayStatus.useQuery(undefined, {
    refetchInterval: 2000,
  });
  const cancelMutation = api.ops.cancelReplay.useMutation({
    onSuccess: () => void statusQuery.refetch(),
  });
  const { scope } = useOpsPermission();

  const status = statusQuery.data;
  // Only show banner while actively running
  if (!status || status.state !== "running") return null;

  const canManage =
    scope?.kind === "platform" || scope?.kind === "organization";

  return (
    <Card.Root borderColor="blue.200" borderWidth="1px">
      <Card.Body padding={4}>
        <HStack justify="space-between">
          <HStack gap={2}>
            <Status.Root colorPalette="blue">
              <Status.Indicator />
            </Status.Root>
            <Text textStyle="sm" fontWeight="semibold">
              Replay running
            </Text>
            {status.currentProjection && (
              <Badge size="sm" variant="subtle">
                {status.currentProjection}
              </Badge>
            )}
          </HStack>
          <HStack gap={2}>
            {status.runId && (
              <Button
                size="xs"
                variant="outline"
                onClick={() =>
                  void router.push(`/ops/projections/${status.runId}`)
                }
              >
                View Progress
              </Button>
            )}
            {canManage && (
              <Button
                size="xs"
                colorPalette="red"
                variant="outline"
                loading={cancelMutation.isPending}
                onClick={() => cancelMutation.mutate()}
              >
                Cancel
              </Button>
            )}
          </HStack>
        </HStack>
      </Card.Body>
    </Card.Root>
  );
}

function formatDuration(startedAt: string, completedAt: string | null): string {
  if (!completedAt) return "—";
  const ms = new Date(completedAt).getTime() - new Date(startedAt).getTime();
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  const mins = Math.floor(ms / 60000);
  const secs = Math.round((ms % 60000) / 1000);
  return `${mins}m ${secs}s`;
}

function ReplayHistoryTable() {
  const router = useRouter();
  const historyQuery = api.ops.getReplayHistory.useQuery(undefined, {
    refetchInterval: 10000,
  });

  const history = historyQuery.data;
  if (!history || history.length === 0) return null;

  return (
    <Card.Root overflow={"hidden"}>
      <Card.Body padding={0}>
        <HStack paddingX={4} paddingY={3}>
          <Text textStyle="sm" fontWeight="medium">
            Replay History
          </Text>
        </HStack>
        <Table.ScrollArea>
          <Table.Root size="sm" variant="line" css={{ "& tr:last-child td": { borderBottom: "none" } }}>
            <Table.Header>
              <Table.Row>
                <Table.ColumnHeader>Status</Table.ColumnHeader>
                <Table.ColumnHeader>Description</Table.ColumnHeader>
                <Table.ColumnHeader>Projections</Table.ColumnHeader>
                <Table.ColumnHeader textAlign="end">Duration</Table.ColumnHeader>
                <Table.ColumnHeader textAlign="end">Aggregates</Table.ColumnHeader>
                <Table.ColumnHeader textAlign="end">Events</Table.ColumnHeader>
                <Table.ColumnHeader>When</Table.ColumnHeader>
                <Table.ColumnHeader width="40px" />
              </Table.Row>
            </Table.Header>
            <Table.Body>
              {history.map((run: any) => {
                const stateColor =
                  run.state === "completed"
                    ? "green"
                    : run.state === "failed"
                      ? "red"
                      : run.state === "cancelled"
                        ? "orange"
                        : run.state === "running"
                          ? "blue"
                          : "gray";

                return (
                  <Table.Row
                    key={run.runId}
                    cursor="pointer"
                    _hover={{ bg: "bg.subtle" }}
                    onClick={() =>
                      void router.push(`/ops/projections/${run.runId}`)
                    }
                  >
                    <Table.Cell>
                      <HStack gap={2}>
                        <Status.Root colorPalette={stateColor}>
                          <Status.Indicator />
                        </Status.Root>
                        <Badge
                          size="sm"
                          variant="subtle"
                          colorPalette={stateColor}
                        >
                          {run.state}
                        </Badge>
                      </HStack>
                    </Table.Cell>
                    <Table.Cell>
                      <Text textStyle="xs" truncate maxW="300px">
                        {run.description ?? "—"}
                      </Text>
                    </Table.Cell>
                    <Table.Cell>
                      <Text textStyle="xs" color="fg.muted">
                        {run.projectionNames?.length ?? 0} projection
                        {(run.projectionNames?.length ?? 0) !== 1 ? "s" : ""}
                      </Text>
                    </Table.Cell>
                    <Table.Cell textAlign="end">
                      <Text textStyle="xs">
                        {formatDuration(run.startedAt, run.completedAt)}
                      </Text>
                    </Table.Cell>
                    <Table.Cell textAlign="end">
                      <Text textStyle="xs">
                        {(run.aggregatesProcessed ?? 0).toLocaleString()}
                      </Text>
                    </Table.Cell>
                    <Table.Cell textAlign="end">
                      <Text textStyle="xs">
                        {(run.eventsProcessed ?? 0).toLocaleString()}
                      </Text>
                    </Table.Cell>
                    <Table.Cell>
                      <Text textStyle="xs" color="fg.muted" whiteSpace="nowrap">
                        {run.startedAt
                          ? new Date(run.startedAt).toLocaleString([], {
                              month: "short",
                              day: "numeric",
                              hour: "2-digit",
                              minute: "2-digit",
                            })
                          : "—"}
                      </Text>
                    </Table.Cell>
                    <Table.Cell>
                      <ArrowRight
                        size={12}
                        style={{ opacity: 0.5 }}
                      />
                    </Table.Cell>
                  </Table.Row>
                );
              })}
            </Table.Body>
          </Table.Root>
        </Table.ScrollArea>
      </Card.Body>
    </Card.Root>
  );
}

function TenantSelector({
  tenantIds,
  onTenantIdsChange,
}: {
  tenantIds: string[];
  onTenantIdsChange: (ids: string[]) => void;
}) {
  const [searchQuery, setSearchQuery] = useState("");
  const searchResults = api.ops.searchTenants.useQuery(
    { query: searchQuery },
    { enabled: searchQuery.length >= 2 },
  );

  return (
    <VStack align="stretch" gap={2}>
      <TagsInput.Root
        size="sm"
        value={tenantIds}
        onValueChange={(details) => onTenantIdsChange(details.value)}
        addOnPaste
        delimiter=","
        blurBehavior="add"
        validate={(e) => e.inputValue.trim().length > 0}
      >
        <TagsInput.Label>
          <Text textStyle="xs" color="fg.muted">
            Tenants
          </Text>
        </TagsInput.Label>
        <TagsInput.Control>
          <TagsInput.Items />
          <TagsInput.Input placeholder="Type tenant ID and press Enter..." />
          <TagsInput.ClearTrigger />
        </TagsInput.Control>
      </TagsInput.Root>

      <Box position="relative">
        <HStack
          gap={2}
          borderWidth="1px"
          borderRadius="md"
          paddingX={3}
          paddingY={1.5}
        >
          <Search size={12} color="var(--chakra-colors-fg-muted)" />
          <input
            style={{
              flex: 1,
              background: "transparent",
              border: "none",
              outline: "none",
              fontSize: "12px",
              color: "inherit",
            }}
            placeholder="Search tenants by name or ID..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </HStack>
        {searchResults.data && searchResults.data.length > 0 && (
          <Box
            position="absolute"
            zIndex={10}
            width="full"
            borderWidth="1px"
            borderRadius="md"
            bg="bg.panel"
            shadow="md"
            maxHeight="200px"
            overflowY="auto"
            marginTop={1}
          >
            {searchResults.data.map((tenant) => (
              <Box
                key={tenant.id}
                paddingX={3}
                paddingY={2}
                cursor="pointer"
                _hover={{ bg: "bg.subtle" }}
                onClick={() => {
                  if (!tenantIds.includes(tenant.id)) {
                    onTenantIdsChange([...tenantIds, tenant.id]);
                  }
                  setSearchQuery("");
                }}
              >
                <HStack gap={2}>
                  <Text textStyle="xs" fontWeight="medium">
                    {tenant.name}
                  </Text>
                  <Text textStyle="xs" color="fg.muted" fontFamily="mono">
                    {tenant.id}
                  </Text>
                  {tenantIds.includes(tenant.id) && (
                    <Badge size="sm" colorPalette="green">
                      added
                    </Badge>
                  )}
                </HStack>
              </Box>
            ))}
          </Box>
        )}
      </Box>
    </VStack>
  );
}

export default function OpsProjectionsPage() {
  const router = useRouter();
  const { hasAccess, isLoading: opsLoading, scope } = useOpsPermission();

  useEffect(() => {
    if (!opsLoading && !hasAccess) {
      void router.push("/");
    }
  }, [hasAccess, opsLoading, router]);

  const [tenantIds, setTenantIds] = useState<string[]>([]);
  const [allTenants, setAllTenants] = useState(false);
  const [since, setSince] = useState("");
  const [selectedProjections, setSelectedProjections] = useState<Set<string>>(
    new Set(),
  );
  const [description, setDescription] = useState("");
  const [drawerOpen, setDrawerOpen] = useState(false);
  const canManage =
    scope?.kind === "platform" || scope?.kind === "organization";

  const projectionsQuery = api.ops.listProjections.useQuery();
  const statusQuery = api.ops.getReplayStatus.useQuery(undefined, {
    refetchInterval: 2000,
  });

  const hasTenants = allTenants || tenantIds.length > 0;
  const hasSince = since.length > 0;
  const canDiscover = hasTenants && hasSince;

  const discoverQuery = api.ops.discoverAggregates.useQuery(
    {
      projectionNames: projectionsQuery.data?.projections.map((p) => p.projectionName) ?? [],
      since,
      tenantIds: allTenants ? [] : tenantIds,
    },
    { enabled: false },
  );

  const hasDiscovered = !!discoverQuery.data;
  const projectionsWithData = new Set(
    discoverQuery.data?.projections
      .filter((p) => p.aggregateCount > 0)
      .map((p) => p.projectionName) ?? [],
  );

  const startReplayMutation = api.ops.startReplay.useMutation({
    onSuccess: (data) => {
      void statusQuery.refetch();
      toaster.create({
        title: "Projection replay started",
        description: `Replaying ${selectedProjections.size} projection${selectedProjections.size !== 1 ? "s" : ""}...`,
        type: "loading",
        duration: 600000,
        meta: { closable: true },
        action: {
          label: "View Progress",
          onClick: () => setDrawerOpen(true),
        },
      });
      setDrawerOpen(true);
    },
    onError: (error) => {
      toaster.create({
        title: "Failed to start replay",
        description: error.message,
        type: "error",
      });
    },
  });

  const [dryRunResult, setDryRunResult] = useState<{
    status: string;
    message: string;
    projectionNames: string[];
    sampleSize: number;
  } | null>(null);
  const [singleAggregateId, setSingleAggregateId] = useState("");
  const [singleTenantId, setSingleTenantId] = useState("");

  const dryRunMutation = api.ops.dryRunReplay.useMutation({
    onSuccess: (data) => {
      setDryRunResult(data);
      toaster.create({
        title: "Dry run complete",
        description: data.message,
        type: "info",
      });
    },
    onError: (error) => {
      toaster.create({
        title: "Dry run failed",
        description: error.message,
        type: "error",
      });
    },
  });

  function toggleProjection(name: string) {
    if (!projectionsWithData.has(name)) return;
    setSelectedProjections((prev) => {
      const next = new Set(prev);
      if (next.has(name)) {
        next.delete(name);
      } else {
        next.add(name);
      }
      return next;
    });
  }

  function selectAllRelevant() {
    setSelectedProjections(new Set(projectionsWithData));
  }

  async function handleDiscover() {
    const result = await discoverQuery.refetch();
    if (result.data) {
      const relevant = new Set(
        result.data.projections
          .filter((p) => p.aggregateCount > 0)
          .map((p) => p.projectionName),
      );
      setSelectedProjections(relevant);
    }
  }

  const totalAggregates =
    discoverQuery.data?.projections
      .filter((p) => selectedProjections.has(p.projectionName))
      .reduce((sum, p) => sum + p.aggregateCount, 0) ?? 0;

  const isReplayRunning = statusQuery.data?.state === "running";

  function handleStartReplay() {
    startReplayMutation.mutate({
      projectionNames: [...selectedProjections],
      since,
      tenantIds: allTenants ? [] : tenantIds,
      description: description || "Manual replay",
    });
  }

  function handleDryRun() {
    dryRunMutation.mutate({
      projectionNames: [...selectedProjections],
      since,
      tenantIds: allTenants ? [] : tenantIds,
    });
  }

  if (opsLoading || !hasAccess) return null;

  return (
    <DashboardLayout>
      <PageLayout.Header>
        <PageLayout.Heading>Projection Replay</PageLayout.Heading>
      </PageLayout.Header>
      <PageLayout.Container>
      <VStack align="stretch" gap={4}>
        <ReplayStatusBanner />

        {projectionsQuery.isLoading && (
          <Center paddingY={20}>
            <Spinner size="lg" />
          </Center>
        )}

        {projectionsQuery.data && projectionsQuery.data.projections.length === 0 && (
          <Center paddingY={20}>
            <EmptyState.Root>
              <EmptyState.Content>
                <EmptyState.Title>No projections registered</EmptyState.Title>
                <EmptyState.Description>
                  No fold projections were found in the pipeline registry.
                </EmptyState.Description>
              </EmptyState.Content>
            </EmptyState.Root>
          </Center>
        )}

        {projectionsQuery.data && projectionsQuery.data.projections.length > 0 && (
          <VStack align="stretch" gap={4}>
            {/* Step 1: Select tenants */}
            <Card.Root>
              <Card.Body padding={4}>
                <HStack marginBottom={3} justify="space-between">
                  <HStack>
                    <Badge size="sm" variant="solid" colorPalette="orange">
                      1
                    </Badge>
                    <Text textStyle="sm" fontWeight="medium">
                      Select tenants
                    </Text>
                  </HStack>
                  <Checkbox
                    size="sm"
                    checked={allTenants}
                    onCheckedChange={(e) => {
                      setAllTenants(!!e.checked);
                      if (e.checked) setTenantIds([]);
                    }}
                  >
                    <Text textStyle="xs">All tenants</Text>
                  </Checkbox>
                </HStack>
                <Box opacity={allTenants ? 0.4 : 1} pointerEvents={allTenants ? "none" : "auto"}>
                  <TenantSelector
                    tenantIds={tenantIds}
                    onTenantIdsChange={setTenantIds}
                  />
                </Box>
                {!hasTenants && !allTenants && (
                  <Text textStyle="xs" color="orange.500" marginTop={2}>
                    At least 1 tenant is required to proceed
                  </Text>
                )}
              </Card.Body>
            </Card.Root>

            {/* Step 2: Select date */}
            <Card.Root opacity={hasTenants ? 1 : 0.5} pointerEvents={hasTenants ? "auto" : "none"}>
              <Card.Body padding={4}>
                <HStack marginBottom={3}>
                  <Badge size="sm" variant="solid" colorPalette={hasTenants ? "orange" : "gray"}>
                    2
                  </Badge>
                  <Text textStyle="sm" fontWeight="medium">
                    Select date range
                  </Text>
                </HStack>
                <HStack gap={3} alignItems="end" flexWrap="wrap">
                  <Box maxWidth="220px">
                    <DatePicker.Root
                      maxWidth="20rem"
                      locale="en-CA"
                      size="sm"
                      value={since ? [since] : []}
                      onValueChange={(details) => {
                        const val = details.valueAsString?.[0];
                        if (val) setSince(val);
                      }}
                    >
                      <DatePicker.Label>
                        <Text textStyle="xs" color="fg.muted">
                          Replay events since
                        </Text>
                      </DatePicker.Label>
                      <DatePicker.Control borderRadius="lg">
                        <DatePicker.Input borderRadius="lg" />
                        <DatePicker.IndicatorGroup>
                          <DatePicker.Trigger>
                            <Calendar size={14} />
                          </DatePicker.Trigger>
                        </DatePicker.IndicatorGroup>
                      </DatePicker.Control>
                      <Portal>
                        <DatePicker.Positioner>
                          <DatePicker.Content>
                            <DatePicker.View view="day">
                              <DatePicker.Header />
                              <DatePicker.DayTable />
                            </DatePicker.View>
                            <DatePicker.View view="month">
                              <DatePicker.Header />
                              <DatePicker.MonthTable />
                            </DatePicker.View>
                            <DatePicker.View view="year">
                              <DatePicker.Header />
                              <DatePicker.YearTable />
                            </DatePicker.View>
                          </DatePicker.Content>
                        </DatePicker.Positioner>
                      </Portal>
                    </DatePicker.Root>
                  </Box>
                  <HStack gap={1}>
                    {[
                      { label: "This month", months: 0 },
                      { label: "2 months", months: 2 },
                      { label: "3 months", months: 3 },
                      { label: "6 months", months: 6 },
                    ].map(({ label, months }) => {
                      const d = new Date();
                      if (months === 0) {
                        d.setDate(1);
                      } else {
                        d.setMonth(d.getMonth() - months);
                      }
                      const value = d.toISOString().slice(0, 10);
                      return (
                        <Button
                          key={label}
                          size="sm"
                          height="36px"
                          variant={since === value ? "solid" : "outline"}
                          onClick={() => setSince(value)}
                        >
                          {label}
                        </Button>
                      );
                    })}
                  </HStack>
                </HStack>
              </Card.Body>
            </Card.Root>

            {/* Step 3: Discover */}
            <Card.Root opacity={canDiscover ? 1 : 0.5} pointerEvents={canDiscover ? "auto" : "none"}>
              <Card.Body padding={4}>
                <HStack marginBottom={3}>
                  <Badge size="sm" variant="solid" colorPalette={canDiscover ? "orange" : "gray"}>
                    3
                  </Badge>
                  <Text textStyle="sm" fontWeight="medium">
                    Discover aggregates
                  </Text>
                </HStack>
                <HStack gap={3}>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={!canDiscover}
                    loading={discoverQuery.isFetching}
                    onClick={() => void handleDiscover()}
                  >
                    Discover
                  </Button>
                  <Text textStyle="xs" color="fg.muted">
                    Scans ClickHouse for events matching {allTenants ? "all tenants" : `${tenantIds.length} tenant${tenantIds.length !== 1 ? "s" : ""}`} since {since || "..."}
                  </Text>
                </HStack>
              </Card.Body>
            </Card.Root>

            {/* Step 4: Projections (only after discover) */}
            {hasDiscovered && (
              <>
                <Card.Root>
                  <Card.Body padding={0} overflowX="auto">
                    <HStack paddingX={4} paddingY={3} justify="space-between">
                      <HStack gap={2}>
                        <Badge size="sm" variant="solid" colorPalette="orange">
                          4
                        </Badge>
                        <Text textStyle="sm" fontWeight="medium">
                          Select projections to replay
                        </Text>
                      </HStack>
                      <Button
                        variant="ghost"
                        size="xs"
                        onClick={selectAllRelevant}
                      >
                        Select all with data
                      </Button>
                    </HStack>
                    <Table.Root size="sm" variant="line">
                      <Table.Header>
                        <Table.Row>
                          <Table.ColumnHeader width="40px" />
                          <Table.ColumnHeader>Projection</Table.ColumnHeader>
                          <Table.ColumnHeader>Pipeline</Table.ColumnHeader>
                          <Table.ColumnHeader textAlign="end">
                            Aggregates
                          </Table.ColumnHeader>
                          <Table.ColumnHeader>Tenants</Table.ColumnHeader>
                        </Table.Row>
                      </Table.Header>
                      <Table.Body>
                        {discoverQuery.data!.projections.map((proj) => {
                          const hasData = proj.aggregateCount > 0;
                          const isSelected = selectedProjections.has(
                            proj.projectionName,
                          );
                          return (
                            <Table.Row
                              key={proj.projectionName}
                              cursor={hasData ? "pointer" : "default"}
                              opacity={hasData ? 1 : 0.4}
                              onClick={() =>
                                toggleProjection(proj.projectionName)
                              }
                              _hover={hasData ? { bg: "bg.subtle" } : undefined}
                              bg={isSelected ? "bg.subtle" : undefined}
                            >
                              <Table.Cell>
                                <Checkbox
                                  checked={isSelected}
                                  disabled={!hasData}
                                  onCheckedChange={() =>
                                    toggleProjection(proj.projectionName)
                                  }
                                />
                              </Table.Cell>
                              <Table.Cell>
                                <HStack gap={2}>
                                  <Text textStyle="sm">
                                    {proj.projectionName}
                                  </Text>
                                  {!hasData && (
                                    <Badge
                                      size="sm"
                                      variant="subtle"
                                      colorPalette="gray"
                                    >
                                      no data
                                    </Badge>
                                  )}
                                </HStack>
                              </Table.Cell>
                              <Table.Cell>
                                <Text textStyle="xs" color="fg.muted">
                                  {projectionsQuery.data?.projections.find(
                                    (p) =>
                                      p.projectionName ===
                                      proj.projectionName,
                                  )?.pipelineName ?? "—"}
                                </Text>
                              </Table.Cell>
                              <Table.Cell textAlign="end">
                                <Text fontWeight="medium">
                                  {proj.aggregateCount}
                                </Text>
                              </Table.Cell>
                              <Table.Cell>
                                <Text textStyle="xs" color="fg.muted">
                                  {proj.tenantBreakdown.length} tenant
                                  {proj.tenantBreakdown.length !== 1
                                    ? "s"
                                    : ""}
                                </Text>
                              </Table.Cell>
                            </Table.Row>
                          );
                        })}
                      </Table.Body>
                    </Table.Root>
                  </Card.Body>
                </Card.Root>

                {/* Summary + Actions */}
                {selectedProjections.size > 0 && (
                  <Card.Root>
                    <Card.Body padding={4}>
                      <HStack gap={6} marginBottom={4}>
                        <Stat.Root>
                          <Stat.Label>Selected Aggregates</Stat.Label>
                          <Stat.ValueText>{totalAggregates}</Stat.ValueText>
                        </Stat.Root>
                        <Stat.Root>
                          <Stat.Label>Projections</Stat.Label>
                          <Stat.ValueText>
                            {selectedProjections.size}
                          </Stat.ValueText>
                        </Stat.Root>
                        <Stat.Root>
                          <Stat.Label>Tenants</Stat.Label>
                          <Stat.ValueText>{tenantIds.length}</Stat.ValueText>
                        </Stat.Root>
                      </HStack>

                      {canManage && (
                        <VStack align="stretch" gap={3}>
                          <Box>
                            <Text
                              textStyle="xs"
                              color="fg.muted"
                              marginBottom={1}
                            >
                              Description (for audit log)
                            </Text>
                            <Textarea
                              size="sm"
                              placeholder="Describe the reason for this replay..."
                              value={description}
                              onChange={(e) => setDescription(e.target.value)}
                              rows={2}
                            />
                          </Box>
                          <HStack gap={2}>
                            <Button
                              size="sm"
                              colorPalette="orange"
                              disabled={
                                isReplayRunning || totalAggregates === 0
                              }
                              loading={startReplayMutation.isPending}
                              onClick={handleStartReplay}
                            >
                              Start Full Replay
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={
                                isReplayRunning || totalAggregates === 0
                              }
                              loading={dryRunMutation.isPending}
                              onClick={handleDryRun}
                            >
                              Dry Run (5 aggregates)
                            </Button>
                            {isReplayRunning && (
                              <Text textStyle="xs" color="orange.500">
                                A replay is already running
                              </Text>
                            )}
                          </HStack>
                          <Text textStyle="xs" color="fg.muted">
                            Full replay pauses projections, drains active jobs,
                            replays events from ClickHouse, then unpauses. Dry
                            run processes 5 sample aggregates in memory without
                            writing.
                          </Text>

                          {dryRunResult && (
                            <Card.Root borderColor="blue.200" borderWidth="1px">
                              <Card.Body padding={3}>
                                <Text textStyle="xs" fontWeight="medium" color="blue.500" marginBottom={1}>
                                  Dry Run Result
                                </Text>
                                <Text textStyle="sm">
                                  {dryRunResult.message}
                                </Text>
                                <Text textStyle="xs" color="fg.muted" marginTop={1}>
                                  Projections: {dryRunResult.projectionNames.join(", ")} | Sample size: {dryRunResult.sampleSize}
                                </Text>
                              </Card.Body>
                            </Card.Root>
                          )}
                        </VStack>
                      )}
                    </Card.Body>
                  </Card.Root>
                )}

                {canManage && (
                  <Card.Root>
                    <Card.Body padding={4}>
                      <Text textStyle="sm" fontWeight="medium" marginBottom={3}>
                        Single Aggregate Replay
                      </Text>
                      <VStack align="stretch" gap={2}>
                        <HStack gap={2}>
                          <Box flex={1}>
                            <Text textStyle="xs" color="fg.muted" marginBottom={1}>
                              Aggregate ID
                            </Text>
                            <Input
                              size="sm"
                              placeholder="e.g. trace_abc123"
                              value={singleAggregateId}
                              onChange={(e) => setSingleAggregateId(e.target.value)}
                              fontFamily="mono"
                            />
                          </Box>
                          <Box flex={1}>
                            <Text textStyle="xs" color="fg.muted" marginBottom={1}>
                              Tenant ID
                            </Text>
                            <Input
                              size="sm"
                              placeholder="e.g. project_xyz"
                              value={singleTenantId}
                              onChange={(e) => setSingleTenantId(e.target.value)}
                              fontFamily="mono"
                            />
                          </Box>
                        </HStack>
                        <HStack gap={2}>
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={
                              !singleAggregateId.trim() ||
                              !singleTenantId.trim() ||
                              selectedProjections.size === 0 ||
                              !since ||
                              isReplayRunning
                            }
                            loading={startReplayMutation.isPending}
                            onClick={() => {
                              startReplayMutation.mutate({
                                projectionNames: [...selectedProjections],
                                since,
                                tenantIds: [singleTenantId.trim()],
                                description: description || `Single aggregate replay: ${singleAggregateId.trim()}`,
                              });
                            }}
                          >
                            Replay Single
                          </Button>
                          <Text textStyle="xs" color="fg.muted">
                            Replays the selected projections for a single tenant
                          </Text>
                        </HStack>
                      </VStack>
                    </Card.Body>
                  </Card.Root>
                )}
              </>
            )}
          </VStack>
        )}
        <ReplayHistoryTable />
      </VStack>
      </PageLayout.Container>
      <ReplayProgressDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
      />
    </DashboardLayout>
  );
}
