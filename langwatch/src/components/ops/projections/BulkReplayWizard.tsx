import { useEffect, useRef, useState } from "react";
import {
  Badge,
  Box,
  Button,
  Card,
  Center,
  EmptyState,
  HStack,
  Input,
  Spinner,
  Stat,
  Table,
  Text,
  Textarea,
  VStack,
} from "@chakra-ui/react";
import { Checkbox } from "~/components/ui/checkbox";
import { api } from "~/utils/api";
import { useOpsPermission } from "~/hooks/useOpsPermission";
import { useReplayStatus } from "~/hooks/useReplayStatus";
import { toaster } from "~/components/ui/toaster";
import { TenantSelector } from "./TenantSelector";

export function BulkReplayWizard({
  onReplayStarted,
}: {
  onReplayStarted: () => void;
}) {
  const { hasAccess } = useOpsPermission();

  const [tenantIds, setTenantIds] = useState<string[]>([]);
  const [allTenants, setAllTenants] = useState(false);
  const [since, setSince] = useState("");
  const [selectedProjections, setSelectedProjections] = useState<Set<string>>(
    new Set(),
  );
  const [description, setDescription] = useState("");

  const projectionsQuery = api.ops.listProjections.useQuery();
  const statusQuery = useReplayStatus();

  const hasTenants = allTenants || tenantIds.length > 0;
  const hasSince = since.length > 0;
  const canDiscover = hasTenants && hasSince;

  const discoverQuery = api.ops.discoverAggregates.useQuery(
    {
      projectionNames:
        projectionsQuery.data?.projections.map((p) => p.projectionName) ?? [],
      since,
      tenantIds: allTenants ? [] : tenantIds,
    },
    { enabled: false },
  );

  const lastDiscoverKey = useRef("");
  useEffect(() => {
    if (!canDiscover) return;
    const key = JSON.stringify({
      tenantIds: allTenants ? [] : tenantIds,
      since,
    });
    if (key === lastDiscoverKey.current) return;
    lastDiscoverKey.current = key;

    void discoverQuery.refetch().then((result) => {
      if (result.data) {
        const relevant = new Set(
          result.data.projections
            .filter((p) => p.aggregateCount > 0)
            .map((p) => p.projectionName),
        );
        setSelectedProjections(relevant);
      }
    });
  }, [canDiscover, allTenants, tenantIds, since]); // eslint-disable-line react-hooks/exhaustive-deps

  const hasDiscovered = !!discoverQuery.data;
  const projectionsWithData = new Set(
    discoverQuery.data?.projections
      .filter((p) => p.aggregateCount > 0)
      .map((p) => p.projectionName) ?? [],
  );

  const startReplayMutation = api.ops.startReplay.useMutation({
    onSuccess: () => {
      void statusQuery.refetch();
      toaster.create({
        title: "Projection replay started",
        description: `Replaying ${selectedProjections.size} projection${selectedProjections.size !== 1 ? "s" : ""}...`,
        type: "success",
      });
      onReplayStarted();
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

  if (projectionsQuery.isLoading) {
    return (
      <Center paddingY={20}>
        <Spinner size="lg" />
      </Center>
    );
  }

  if (
    projectionsQuery.data &&
    projectionsQuery.data.projections.length === 0
  ) {
    return (
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
    );
  }

  if (!projectionsQuery.data) return null;

  return (
    <VStack align="stretch" gap={4}>
      {/* Step 1: Select tenants */}
      <Card.Root>
        <Card.Body padding={4}>
          <HStack marginBottom={3} justify="space-between">
            <Text textStyle="sm" fontWeight="medium">
              1. Select tenants
            </Text>
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
          <Box
            opacity={allTenants ? 0.4 : 1}
            pointerEvents={allTenants ? "none" : "auto"}
          >
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

      {/* Step 2: Choose date range */}
      <Card.Root
        opacity={hasTenants ? 1 : 0.5}
        pointerEvents={hasTenants ? "auto" : "none"}
      >
        <Card.Body padding={4}>
          <Text textStyle="sm" fontWeight="medium" marginBottom={3}>
            2. Choose date range
          </Text>
          <HStack gap={3} alignItems="end" flexWrap="wrap">
            <Box maxWidth="220px">
              <Text textStyle="xs" color="fg.muted" marginBottom={1}>
                Replay events since
              </Text>
              <Input
                type="date"
                size="sm"
                value={since}
                onChange={(e) => setSince(e.target.value)}
              />
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

          {canDiscover && discoverQuery.isFetching && (
            <HStack gap={2} marginTop={3}>
              <Spinner size="xs" />
              <Text textStyle="xs" color="fg.muted">
                Discovering aggregates...
              </Text>
            </HStack>
          )}
        </Card.Body>
      </Card.Root>

      {/* Step 3: Select projections */}
      {hasDiscovered && (
        <>
          <Card.Root>
            <Card.Body padding={0} overflowX="auto">
              <HStack paddingX={4} paddingY={3} justify="space-between">
                <Text textStyle="sm" fontWeight="medium">
                  3. Select projections to replay
                </Text>
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
                        onClick={() => toggleProjection(proj.projectionName)}
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
                            <Text textStyle="sm">{proj.projectionName}</Text>
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
                                p.projectionName === proj.projectionName,
                            )?.pipelineName ?? "\u2014"}
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
                            {proj.tenantBreakdown.length !== 1 ? "s" : ""}
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
                    <Stat.ValueText>
                      {allTenants ? "All" : tenantIds.length}
                    </Stat.ValueText>
                  </Stat.Root>
                </HStack>

                {hasAccess && (
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
                        disabled={isReplayRunning || totalAggregates === 0}
                        loading={startReplayMutation.isPending}
                        onClick={handleStartReplay}
                      >
                        Start Full Replay
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={isReplayRunning || totalAggregates === 0}
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
                      replays events from ClickHouse, then unpauses. Dry run
                      processes 5 sample aggregates in memory without writing.
                    </Text>

                    {dryRunResult && (
                      <Card.Root borderColor="blue.200" borderWidth="1px">
                        <Card.Body padding={3}>
                          <Text
                            textStyle="xs"
                            fontWeight="medium"
                            color="blue.500"
                            marginBottom={1}
                          >
                            Dry Run Result
                          </Text>
                          <Text textStyle="sm">{dryRunResult.message}</Text>
                          <Text
                            textStyle="xs"
                            color="fg.muted"
                            marginTop={1}
                          >
                            Projections:{" "}
                            {dryRunResult.projectionNames.join(", ")} | Sample
                            size: {dryRunResult.sampleSize}
                          </Text>
                        </Card.Body>
                      </Card.Root>
                    )}
                  </VStack>
                )}
              </Card.Body>
            </Card.Root>
          )}
        </>
      )}
    </VStack>
  );
}
