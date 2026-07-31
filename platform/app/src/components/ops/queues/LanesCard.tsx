import {
  Badge,
  Box,
  Button,
  Card,
  Center,
  HStack,
  Input,
  Spacer,
  Spinner,
  Table,
  Text,
} from "@chakra-ui/react";
import { Search } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { ConfirmDialog } from "~/components/ops/shared/ConfirmDialog";
import { VirtualizedTableRows } from "~/components/ops/shared/VirtualizedTableRows";
import { toaster } from "~/components/ui/toaster";
import { showErrorToast } from "~/features/errors";
import { useOpsPermission } from "~/hooks/useOpsPermission";
import type { LaneKindSummary } from "~/server/app-layer/ops/types";
import { api } from "~/utils/api";
import { LaneDetailDialog } from "./LaneDetailDialog";
import { LaneRow } from "./LaneRow";
import {
  countLaneStatuses,
  filterLanes,
  LANE_STATUS_COLORS,
  LANE_STATUS_FILTERS,
  LANE_STATUS_LABELS,
  type LaneStatusFilter,
  resolveTenantScope,
} from "./laneFilters";

const LANES_VIEWPORT_HEIGHT = 480;
const LANES_ROW_HEIGHT = 36;
const LANES_PAGE_SIZE = 200;

/**
 * The lane listing for one lane kind.
 *
 * Everything here is a lane key: depth, lease, backoff deadline and park state.
 * The old per-pipeline and per-tenant pause switches are gone with the plane
 * that stored them, so the only recovery actions offered are the ones the
 * dispatch plane can still perform — unpark and drain.
 */
export function LanesCard({ laneKinds }: { laneKinds: LaneKindSummary[] }) {
  const { hasAccess } = useOpsPermission();
  const utils = api.useContext();

  const [selectedKind, setSelectedKind] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<LaneStatusFilter>("all");
  const [search, setSearch] = useState("");
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  // The kind list is re-broadcast every couple of seconds, so the selection is
  // resolved against the current list rather than stored and corrected later.
  const activeKind = useMemo(() => {
    if (selectedKind && laneKinds.some((kind) => kind.name === selectedKind)) {
      return selectedKind;
    }
    return laneKinds[0]?.name ?? null;
  }, [selectedKind, laneKinds]);

  const lanesQuery = api.ops.listLanes.useQuery(
    { laneKind: activeKind ?? "", page: 1, pageSize: LANES_PAGE_SIZE },
    { refetchInterval: 10000, enabled: !!activeKind },
  );

  const lanes = useMemo(() => lanesQuery.data?.lanes ?? [], [lanesQuery.data]);
  const counts = useMemo(() => countLaneStatuses(lanes), [lanes]);
  const filteredLanes = useMemo(
    () => filterLanes({ lanes, status: statusFilter, search }),
    [lanes, statusFilter, search],
  );
  const tenantScope = useMemo(
    () => resolveTenantScope({ lanes, search }),
    [lanes, search],
  );

  // Filter changes shrink the visible row count without re-mounting the scroll
  // container, so the virtualizer's total height drops while scrollTop holds
  // its old value — leaving blank space below the rows until the user scrolls.
  useEffect(() => {
    if (scrollContainerRef.current) scrollContainerRef.current.scrollTop = 0;
  }, [statusFilter, search, activeKind]);

  const [selectedLane, setSelectedLane] = useState<{
    laneKind: string;
    laneId: string;
  } | null>(null);
  const [drainTarget, setDrainTarget] = useState<string | null>(null);
  const [drainTenantTarget, setDrainTenantTarget] = useState<string | null>(
    null,
  );
  const [unparkAllTarget, setUnparkAllTarget] = useState<string | null>(null);

  const unparkMutation = api.ops.unparkLane.useMutation({
    onSuccess: (data) => {
      toaster.create({
        title: data.wasParked ? "Lane unparked" : "Lane was not parked",
        type: data.wasParked ? "success" : "info",
      });
      void utils.ops.invalidate();
    },
    onError: (error) =>
      showErrorToast({ error, fallbackTitle: "Couldn't unpark the lane" }),
  });
  const unparkAllMutation = api.ops.unparkAll.useMutation({
    onSuccess: (data) => {
      toaster.create({
        title: `Unparked ${data.unparkedCount} lanes`,
        type: "success",
      });
      setUnparkAllTarget(null);
      void utils.ops.invalidate();
    },
    onError: (error) =>
      showErrorToast({ error, fallbackTitle: "Couldn't unpark the lanes" }),
  });
  const drainLaneMutation = api.ops.drainLane.useMutation({
    onSuccess: (data) => {
      toaster.create({
        title: `Drained, removed ${data.jobsRemoved} jobs`,
        type: "success",
      });
      setDrainTarget(null);
      void utils.ops.invalidate();
    },
    onError: (error) =>
      showErrorToast({ error, fallbackTitle: "Couldn't drain the lane" }),
  });
  const drainTenantMutation = api.ops.drainTenant.useMutation({
    onSuccess: (data, vars) => {
      toaster.create({
        title: `Drained ${data.lanesDrained} lanes (${data.jobsDrained} jobs) for ${vars.tenantId}`,
        type: "success",
      });
      setDrainTenantTarget(null);
      void utils.ops.invalidate();
    },
    onError: (error) => {
      showErrorToast({
        error,
        fallbackTitle: "Couldn't drain the tenant's lanes",
      });
      setDrainTenantTarget(null);
    },
  });

  const activeKindSummary = laneKinds.find((kind) => kind.name === activeKind);

  return (
    <>
      <Card.Root>
        <Card.Body padding={0}>
          <HStack
            paddingX={4}
            paddingY={2.5}
            borderBottom="1px solid"
            borderBottomColor="border"
            gap={2}
            flexWrap="wrap"
          >
            <Text textStyle="sm" fontWeight="medium">
              Lanes
            </Text>
            <HStack gap={1} flexWrap="wrap">
              {laneKinds.map((kind) => (
                <Button
                  key={kind.name}
                  size="2xs"
                  variant={kind.name === activeKind ? "solid" : "ghost"}
                  colorPalette={kind.parkedLaneCount > 0 ? "red" : "gray"}
                  onClick={() => setSelectedKind(kind.name)}
                >
                  {kind.displayName} ({kind.laneCount})
                </Button>
              ))}
            </HStack>
            <Spacer />
            {hasAccess &&
              activeKind &&
              (activeKindSummary?.parkedLaneCount ?? 0) > 0 && (
                <Button
                  variant="outline"
                  size="2xs"
                  colorPalette="orange"
                  onClick={() => setUnparkAllTarget(activeKind)}
                >
                  Unpark all ({activeKindSummary?.parkedLaneCount})
                </Button>
              )}
            <Box position="relative" width="200px">
              <Box
                position="absolute"
                left={2.5}
                top="50%"
                transform="translateY(-50%)"
                zIndex={1}
              >
                <Search size={11} color="var(--chakra-colors-fg-muted)" />
              </Box>
              <Input
                size="xs"
                placeholder="Lane, tenant or park reason..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                paddingLeft={7}
              />
            </Box>
          </HStack>

          {lanes.length > 0 && (
            <HStack
              paddingX={4}
              paddingY={2}
              borderBottom="1px solid"
              borderBottomColor="border"
              gap={1}
              flexWrap="wrap"
            >
              {LANE_STATUS_FILTERS.map((value) => (
                <Button
                  key={value}
                  size="2xs"
                  variant={statusFilter === value ? "solid" : "ghost"}
                  colorPalette={LANE_STATUS_COLORS[value]}
                  onClick={() => setStatusFilter(value)}
                >
                  {LANE_STATUS_LABELS[value]}{" "}
                  {counts[value] > 0 ? `(${counts[value]})` : ""}
                </Button>
              ))}
            </HStack>
          )}

          {/* Tenant-wide drain. Offered only when the search box holds a bare
              tenant id that a listed lane belongs to — the action removes every
              staged job that tenant owns and cannot be undone, so it must never
              be reachable from a partial match. */}
          {hasAccess && tenantScope && (
            <HStack
              paddingX={4}
              paddingY={2}
              borderBottom="1px solid"
              borderBottomColor="border"
              gap={2}
              flexWrap="wrap"
              bg="bg.subtle"
            >
              <Text textStyle="xs" fontWeight="medium">
                Tenant actions:
              </Text>
              <Badge size="xs" variant="subtle" fontFamily="mono">
                {tenantScope}
              </Badge>
              <Button
                size="2xs"
                variant="outline"
                colorPalette="red"
                onClick={() => setDrainTenantTarget(tenantScope)}
              >
                Drain all tenant lanes
              </Button>
            </HStack>
          )}

          {!activeKind ? (
            <Box padding={4}>
              <Text textStyle="xs" color="fg.muted">
                No lane kinds registered yet — nothing has been staged.
              </Text>
            </Box>
          ) : lanesQuery.isLoading ? (
            <Center paddingY={6}>
              <Spinner size="sm" />
            </Center>
          ) : lanes.length === 0 ? (
            <Box padding={4}>
              <Text textStyle="xs" color="fg.muted">
                No lanes registered for {activeKind}.
              </Text>
            </Box>
          ) : filteredLanes.length === 0 ? (
            <Box padding={4}>
              <Text textStyle="xs" color="fg.muted">
                No lanes match the current filters.
              </Text>
            </Box>
          ) : (
            <Box
              ref={scrollContainerRef}
              maxHeight={`${LANES_VIEWPORT_HEIGHT}px`}
              overflowY="auto"
            >
              <Table.Root
                size="sm"
                variant="line"
                css={{ "& tr:last-child td": { borderBottom: "none" } }}
              >
                <Table.Header position="sticky" top={0} zIndex={1} bg="bg">
                  <Table.Row>
                    <Table.ColumnHeader>Lane</Table.ColumnHeader>
                    <Table.ColumnHeader width="140px">Name</Table.ColumnHeader>
                    <Table.ColumnHeader textAlign="end" width="50px">
                      Pend.
                    </Table.ColumnHeader>
                    <Table.ColumnHeader textAlign="end" width="45px">
                      Try
                    </Table.ColumnHeader>
                    <Table.ColumnHeader width="80px">Lease</Table.ColumnHeader>
                    <Table.ColumnHeader width="85px">Status</Table.ColumnHeader>
                    {hasAccess && (
                      <Table.ColumnHeader width="110px">
                        Actions
                      </Table.ColumnHeader>
                    )}
                  </Table.Row>
                </Table.Header>
                <Table.Body>
                  <VirtualizedTableRows
                    count={filteredLanes.length}
                    rowHeight={LANES_ROW_HEIGHT}
                    columnCount={hasAccess ? 7 : 6}
                    scrollContainerRef={scrollContainerRef}
                    getItemKey={(i) => filteredLanes[i]!.laneId}
                    renderRow={(i) => {
                      const lane = filteredLanes[i]!;
                      return (
                        <LaneRow
                          key={lane.laneId}
                          lane={lane}
                          hasAccess={hasAccess}
                          isUnparking={
                            unparkMutation.isPending &&
                            unparkMutation.variables?.laneId === lane.laneId
                          }
                          onOpen={() =>
                            setSelectedLane({
                              laneKind: lane.laneKind,
                              laneId: lane.laneId,
                            })
                          }
                          onUnpark={() =>
                            unparkMutation.mutate({ laneId: lane.laneId })
                          }
                          onDrain={() => setDrainTarget(lane.laneId)}
                        />
                      );
                    }}
                  />
                </Table.Body>
              </Table.Root>
            </Box>
          )}
        </Card.Body>
      </Card.Root>

      <LaneDetailDialog
        lane={selectedLane}
        onClose={() => setSelectedLane(null)}
      />

      <ConfirmDialog
        open={!!unparkAllTarget}
        onClose={() => setUnparkAllTarget(null)}
        onConfirm={() => {
          if (unparkAllTarget)
            unparkAllMutation.mutate({ laneKind: unparkAllTarget });
        }}
        title="Unpark all lanes"
        description={`Unpark every parked ${unparkAllTarget} lane. Their staged jobs retry from where they stopped.`}
        isLoading={unparkAllMutation.isPending}
      />

      <ConfirmDialog
        open={!!drainTarget}
        onClose={() => setDrainTarget(null)}
        onConfirm={() => {
          if (drainTarget) drainLaneMutation.mutate({ laneId: drainTarget });
        }}
        title="Drain lane"
        description={`Permanently remove every staged job from "${drainTarget}". Cannot be undone.`}
        isLoading={drainLaneMutation.isPending}
      />

      <ConfirmDialog
        open={!!drainTenantTarget}
        onClose={() => setDrainTenantTarget(null)}
        onConfirm={() => {
          if (drainTenantTarget)
            drainTenantMutation.mutate({ tenantId: drainTenantTarget });
        }}
        title="Drain all tenant lanes"
        description={`Permanently remove every staged job for tenant "${drainTenantTarget}", across every lane kind. Cannot be undone. The event log in ClickHouse is preserved, so the work can be replayed later.`}
        isLoading={drainTenantMutation.isPending}
      />
    </>
  );
}
