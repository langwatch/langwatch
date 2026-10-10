import { DetailDrawerHeader } from "@langwatch/design-system/detail-drawer-header";
import { Drawer } from "@langwatch/design-system/drawer";
import { ListPageSkeleton } from "@langwatch/design-system/list-page";
import {
  Badge,
  Alert,
  Card,
  Button,
  HStack,
  Progress,
  Separator,
  Text,
  VStack,
} from "@langwatch/design-system/primitives";
import { CompactStat } from "@langwatch/design-system/stat-tile";
import { HandledErrorAlert } from "@langwatch/error-views";
import { nowInstant, toEpochMs } from "@langwatch/time";
import { useMemo } from "react";

import { api } from "../../../../behavior/ops-api.ts";
import { useOpsRouter as useRouter } from "../../../../behavior/ops-router.ts";
import { useOpsPermission } from "../../../../behavior/ops-session.ts";
import { formatDuration } from "../../../../model/ops-formatters.ts";
import { useReplayStatus } from "../../behavior/use-replay-status.ts";
import { parseActiveProjections } from "../../model/replay-presentation.ts";
import { PHASE_ICONS, PHASE_LABELS, PhaseTimeline } from "../elements/phase-timeline.tsx";

/** The tint each terminal replay state carries; anything running stays blue. */
const STATE_COLORS: Record<string, string> = {
  completed: "green",
  failed: "red",
  cancelled: "orange",
};

export function ReplayProgressDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const router = useRouter();
  const { hasAccess } = useOpsPermission();

  const statusQuery = useReplayStatus();

  const cancelMutation = api.ops.cancelReplay.useMutation({
    onSuccess: () => void statusQuery.refetch(),
  });

  const status = statusQuery.data;
  const isRunning = status?.state === "running";

  const stateColor = STATE_COLORS[status?.state ?? ""] ?? "blue";

  return (
    <Drawer.Root
      open={open}
      onOpenChange={(e) => {
        if (!e.open) onClose();
      }}
      placement="end"
      size="sm"
    >
      <Drawer.Content>
        <Drawer.Header>
          <DetailDrawerHeader kind="Event replay" title={`Replay ${status?.state ?? "idle"}`}>
            <Badge colorPalette={stateColor}>{status?.state ?? "idle"}</Badge>
          </DetailDrawerHeader>
          <Drawer.CloseTrigger />
        </Drawer.Header>
        <Drawer.Body>
          <ReplayReadState query={statusQuery} stateColor={stateColor} />
        </Drawer.Body>
        <Drawer.Footer>
          <HStack gap={2} width="full">
            {status?.runId && (
              <Button
                size="sm"
                variant="outline"
                flex={1}
                onClick={() => {
                  router.push(`/ops/projections/${status.runId}`);
                  onClose();
                }}
              >
                Full Page View
              </Button>
            )}
            {isRunning && hasAccess && (
              <Button
                size="sm"
                colorPalette="red"
                variant="outline"
                loading={cancelMutation.isPending}
                onClick={() => cancelMutation.mutate()}
              >
                Cancel
              </Button>
            )}
          </HStack>
        </Drawer.Footer>
      </Drawer.Content>
    </Drawer.Root>
  );
}

function ReplayReadState({
  query,
  stateColor,
}: {
  query: ReturnType<typeof useReplayStatus>;
  stateColor: string;
}) {
  if (query.isPending) return <ListPageSkeleton label="Loading replay progress" />;
  if (query.isError && !query.data)
    return <HandledErrorAlert error={query.error} fallbackTitle="Replay progress could not load" />;
  if (!query.data || query.data.state === "idle")
    return (
      <Text textStyle="sm" color="fg.muted">
        No replay is currently running.
      </Text>
    );
  return (
    <>
      {query.isError && (
        <HandledErrorAlert
          error={query.error}
          fallbackTitle="Replay progress could not refresh; showing the last snapshot"
        />
      )}
      <ReplayStatusDetail status={query.data} stateColor={stateColor} />
    </>
  );
}

type ReplayStatus = NonNullable<ReturnType<typeof useReplayStatus>["data"]>;

/** A replay that has started: its phase, progress, throughput and projections. */
function ReplayStatusDetail({ status, stateColor }: { status: ReplayStatus; stateColor: string }) {
  const isRunning = status.state === "running";
  const activeProjectionNames = parseActiveProjections(status.currentProjection);
  const activeProjections = new Set(activeProjectionNames);
  const progressPercent =
    status.aggregatesTotal > 0
      ? Math.round((status.aggregatesProcessed / status.aggregatesTotal) * 100)
      : 0;

  const throughputRate = useMemo(() => {
    if (!status.startedAt || !status.eventsProcessed) return null;
    const end = status.completedAt ? toEpochMs(status.completedAt) : nowInstant().epochMilliseconds;
    const elapsed = (end - toEpochMs(status.startedAt)) / 1000;
    if (elapsed < 1) return null;
    return Math.round(status.eventsProcessed / elapsed);
  }, [status.startedAt, status.completedAt, status.eventsProcessed]);

  return (
    <VStack align="stretch" gap={4}>
      {/* Phase timeline */}
      <PhaseTimeline
        currentPhase={status.currentPhase}
        completedState={
          status.state !== "running" ? (status.state as "completed" | "failed" | "cancelled") : null
        }
      />

      {/* Current phase detail */}
      {status.currentPhase && (
        <HStack gap={2}>
          <Text textStyle="lg">{PHASE_ICONS[status.currentPhase] ?? "·"}</Text>
          <VStack align="start" gap={0}>
            <Text textStyle="sm" fontWeight="medium">
              {PHASE_LABELS[status.currentPhase] ?? status.currentPhase}
            </Text>
            {activeProjectionNames.length > 0 && (
              <Text textStyle="xs" color="fg.muted">
                {activeProjectionNames.length === 1
                  ? activeProjectionNames[0]
                  : `${activeProjectionNames.length} projections`}
              </Text>
            )}
          </VStack>
        </HStack>
      )}

      {/* Progress bar */}
      {status.aggregatesTotal > 0 && (
        <VStack align="stretch" gap={1}>
          <HStack justify="space-between">
            <Text textStyle="xs" color="fg.muted">
              Aggregates
            </Text>
            <Text textStyle="xs" fontWeight="medium">
              {status.aggregatesProcessed.toLocaleString()} /{" "}
              {status.aggregatesTotal.toLocaleString()} ({progressPercent}%)
            </Text>
          </HStack>
          <Progress.Root value={progressPercent} size="sm" colorPalette={stateColor}>
            <Progress.Track>
              <Progress.Range />
            </Progress.Track>
          </Progress.Root>
        </VStack>
      )}

      <Separator />

      <Card.Root variant="subtle">
        <Card.Body>
          <HStack gap={4} wrap="wrap">
            <CompactStat label="Events" value={status.eventsProcessed.toLocaleString()} />
            <CompactStat label="Projections" value={String(status.projectionNames.length)} />
            {throughputRate !== null && (
              <CompactStat label="Events/s" value={throughputRate.toLocaleString()} />
            )}
            <CompactStat
              label="Elapsed"
              value={status.startedAt ? formatDuration(status.startedAt, status.completedAt) : "—"}
            />
          </HStack>
        </Card.Body>
      </Card.Root>

      {/* Projection list */}
      <VStack align="stretch" gap={1}>
        <Text textStyle="xs" color="fg.muted">
          Projections
        </Text>
        <HStack gap={1} flexWrap="wrap">
          {status.projectionNames.map((name) => (
            <Badge
              key={name}
              size="sm"
              variant={isRunning && activeProjections.has(name) ? "solid" : "subtle"}
              colorPalette={isRunning && activeProjections.has(name) ? "orange" : "gray"}
            >
              {name}
            </Badge>
          ))}
        </HStack>
      </VStack>

      {/* Description */}
      {status.description && (
        <VStack align="stretch" gap={1}>
          <Text textStyle="xs" color="fg.muted">
            Description
          </Text>
          <Text textStyle="sm">{status.description}</Text>
        </VStack>
      )}

      {/* Error */}
      {status.error && (
        <Alert.Root status="error">
          <Alert.Indicator />
          <Alert.Content>
            <Alert.Title>Error</Alert.Title>
            <Alert.Description overflowWrap="anywhere">{status.error}</Alert.Description>
          </Alert.Content>
        </Alert.Root>
      )}
    </VStack>
  );
}
