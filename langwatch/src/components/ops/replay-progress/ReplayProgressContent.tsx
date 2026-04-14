import {
  Badge,
  Box,
  Button,
  Card,
  Center,
  HStack,
  Progress,
  Spinner,
  Status,
  Text,
  VStack,
} from "@chakra-ui/react";
import { ArrowLeft } from "lucide-react";
import { api } from "~/utils/api";
import { useOpsPermission } from "~/hooks/useOpsPermission";
import { Link } from "~/components/ui/link";
import { formatDuration } from "~/components/ops/shared/formatters";
import { replayStateColor } from "~/components/ops/shared/ReplayStateBadge";
import { PhaseTimeline } from "~/components/ops/shared/PhaseTimeline";
import { CowboyAnimation } from "./CowboyAnimation";
import type { ReplayStatus, ReplayHistoryEntry } from "~/server/app-layer/ops/repositories/replay.repository";

export function ReplayProgressContent({ runId }: { runId: string }) {
  const statusQuery = api.ops.getReplayStatus.useQuery(undefined, {
    refetchInterval: 1500,
  });
  const historyQuery = api.ops.getReplayRun.useQuery(
    { runId },
    { refetchInterval: false },
  );
  const cancelMutation = api.ops.cancelReplay.useMutation({
    onSuccess: () => {
      void statusQuery.refetch();
    },
  });

  const { scope } = useOpsPermission();
  const canManage =
    scope?.kind === "platform" || scope?.kind === "organization";

  const liveStatus = statusQuery.data as ReplayStatus | undefined;
  const historyEntry = historyQuery.data as ReplayHistoryEntry | null | undefined;

  // Use live status when it matches this run, otherwise fall back to history
  const isLiveRun = liveStatus?.runId === runId && liveStatus.state !== "idle";
  const isRunning = isLiveRun && liveStatus?.state === "running";

  const stateColor = replayStateColor(
    isLiveRun
      ? (liveStatus?.state ?? "idle")
      : (historyEntry?.state ?? "idle"),
  );

  const progressPercent =
    isLiveRun && liveStatus && liveStatus.aggregatesTotal > 0
      ? Math.round(
          (liveStatus.aggregatesProcessed / liveStatus.aggregatesTotal) * 100,
        )
      : 0;

  const meshGradientStyle = isRunning
    ? {
        background:
          "linear-gradient(135deg, rgba(251,146,60,0.05) 0%, rgba(251,146,60,0.12) 25%, rgba(234,88,12,0.08) 50%, rgba(251,146,60,0.12) 75%, rgba(251,146,60,0.05) 100%)",
        backgroundSize: "200% 200%",
        animation: "meshPulse 4s ease infinite",
      }
    : {};

  const isLoading = statusQuery.isLoading || historyQuery.isLoading;
  const hasData = isLiveRun || historyEntry;

  return (
    <>
      <style>{`
        @keyframes meshPulse {
          0%, 100% { background-position: 0% 50%; }
          50% { background-position: 100% 50%; }
        }
      `}</style>

      <Box style={meshGradientStyle} borderRadius="lg" padding={4}>
        <HStack marginBottom={4}>
          <Link href="/ops/projections" _hover={{ textDecoration: "none" }}>
            <HStack gap={1} color="fg.muted" _hover={{ color: "fg" }}>
              <ArrowLeft size={14} />
              <Text textStyle="xs">Back to Projections</Text>
            </HStack>
          </Link>
        </HStack>

        {isLoading && (
          <Center paddingY={20}>
            <Spinner size="lg" />
          </Center>
        )}

        {!isLoading && !hasData && (
          <Center paddingY={20}>
            <VStack gap={2}>
              <Text textStyle="sm" color="fg.muted">
                No replay found for this run ID.
              </Text>
              <Link href="/ops/projections">
                <Button size="sm" variant="outline">
                  Back to Projections
                </Button>
              </Link>
            </VStack>
          </Center>
        )}

        {hasData && isLiveRun && liveStatus && (
          <LiveRunView
            status={liveStatus}
            stateColor={stateColor}
            progressPercent={progressPercent}
            isRunning={!!isRunning}
            canManage={canManage}
            cancelMutation={cancelMutation}
          />
        )}

        {hasData && !isLiveRun && historyEntry && (
          <HistoricalRunView entry={historyEntry} stateColor={stateColor} />
        )}
      </Box>
    </>
  );
}

function LiveRunView({
  status,
  stateColor,
  progressPercent,
  isRunning,
  canManage,
  cancelMutation,
}: {
  status: ReplayStatus;
  stateColor: string;
  progressPercent: number;
  isRunning: boolean;
  canManage: boolean;
  cancelMutation: { isPending: boolean; mutate: () => void };
}) {
  return (
    <VStack align="stretch" gap={4}>
      {/* Cowboys animation */}
      <Card.Root overflow="hidden">
        <Card.Body padding={6}>
          <Center>
            <CowboyAnimation
              phase={isRunning ? status.currentPhase : null}
            />
          </Center>
        </Card.Body>
      </Card.Root>

      {/* Phase timeline */}
      <PhaseTimeline
        currentPhase={status.currentPhase}
        completedState={
          !isRunning
            ? (status.state as "completed" | "failed" | "cancelled")
            : null
        }
      />

      {/* Status card */}
      <Card.Root>
        <Card.Body padding={4}>
          <VStack align="stretch" gap={3}>
            <HStack justify="space-between">
              <HStack gap={2}>
                <Status.Root colorPalette={stateColor}>
                  <Status.Indicator />
                </Status.Root>
                <Text textStyle="sm" fontWeight="semibold">
                  Replay{" "}
                  {status.state === "running"
                    ? "in progress"
                    : status.state}
                </Text>
                {status.currentProjection && isRunning && (
                  <Badge size="sm" variant="subtle">
                    {status.currentProjection}
                  </Badge>
                )}
                {status.currentPhase && isRunning && (
                  <Badge
                    size="sm"
                    variant="outline"
                    colorPalette="orange"
                  >
                    {status.currentPhase}
                  </Badge>
                )}
              </HStack>
              {isRunning && canManage && (
                <Button
                  size="xs"
                  colorPalette="red"
                  variant="outline"
                  loading={cancelMutation.isPending}
                  onClick={() => cancelMutation.mutate()}
                >
                  Cancel Replay
                </Button>
              )}
            </HStack>

            {status.description && (
              <Text textStyle="xs" color="fg.muted">
                {status.description}
              </Text>
            )}

            {isRunning && (
              <VStack align="stretch" gap={1}>
                <Progress.Root
                  size="sm"
                  value={progressPercent}
                  colorPalette="orange"
                >
                  <Progress.Track>
                    <Progress.Range />
                  </Progress.Track>
                </Progress.Root>
                <HStack justify="space-between">
                  <Text textStyle="xs" color="fg.muted">
                    {status.aggregatesProcessed} /{" "}
                    {status.aggregatesTotal} aggregates (
                    {progressPercent}%)
                  </Text>
                  <Text textStyle="xs" color="fg.muted">
                    {status.eventsProcessed.toLocaleString()} events
                  </Text>
                </HStack>
              </VStack>
            )}

            {status.state === "completed" && (
              <HStack gap={4} flexWrap="wrap">
                <Text textStyle="xs" color="fg.muted">
                  {status.aggregatesProcessed} aggregates replayed
                </Text>
                <Text textStyle="xs" color="fg.muted">
                  {status.eventsProcessed.toLocaleString()} events
                  processed
                </Text>
                {status.completedAt && (
                  <Text textStyle="xs" color="fg.muted">
                    Completed at{" "}
                    {new Date(status.completedAt).toLocaleString()}
                  </Text>
                )}
              </HStack>
            )}

            {status.state === "failed" && status.error && (
              <Box bg="red.subtle" padding={3} borderRadius="md">
                <Text textStyle="xs" color="red.500">
                  {status.error}
                </Text>
              </Box>
            )}

            {status.startedAt && (
              <Text textStyle="xs" color="fg.muted">
                Duration: {formatDuration(status.startedAt, status.completedAt)}
                {status.userName && ` | Started by ${status.userName}`}
              </Text>
            )}

            <HStack gap={2} flexWrap="wrap">
              {status.projectionNames.map((name) => (
                <Badge key={name} size="sm" variant="subtle">
                  {name}
                </Badge>
              ))}
            </HStack>
          </VStack>
        </Card.Body>
      </Card.Root>
    </VStack>
  );
}

function HistoricalRunView({
  entry,
  stateColor,
}: {
  entry: ReplayHistoryEntry;
  stateColor: string;
}) {
  return (
    <VStack align="stretch" gap={4}>
      {/* Phase timeline — all done for completed, none for failed */}
      <PhaseTimeline
        currentPhase={null}
        completedState={entry.state}
      />

      {/* Status card */}
      <Card.Root>
        <Card.Body padding={4}>
          <VStack align="stretch" gap={3}>
            <HStack gap={2}>
              <Status.Root colorPalette={stateColor}>
                <Status.Indicator />
              </Status.Root>
              <Text textStyle="sm" fontWeight="semibold">
                Replay {entry.state}
              </Text>
            </HStack>

            {entry.description && (
              <Text textStyle="xs" color="fg.muted">
                {entry.description}
              </Text>
            )}

            <HStack gap={4} flexWrap="wrap">
              <Text textStyle="xs" color="fg.muted">
                {entry.aggregatesProcessed.toLocaleString()} aggregates
              </Text>
              <Text textStyle="xs" color="fg.muted">
                {entry.eventsProcessed.toLocaleString()} events
              </Text>
              <Text textStyle="xs" color="fg.muted">
                Duration: {formatDuration(entry.startedAt, entry.completedAt)}
              </Text>
              {entry.completedAt && (
                <Text textStyle="xs" color="fg.muted">
                  {entry.state === "completed" ? "Completed" : "Ended"} at{" "}
                  {new Date(entry.completedAt).toLocaleString()}
                </Text>
              )}
              {entry.userName && (
                <Text textStyle="xs" color="fg.muted">
                  Started by {entry.userName}
                </Text>
              )}
            </HStack>

            {entry.state === "failed" && entry.error && (
              <Box
                bg="red.subtle"
                padding={3}
                borderRadius="md"
                borderWidth="1px"
                borderColor="red.200"
              >
                <Text textStyle="xs" fontWeight="medium" color="red.500" marginBottom={1}>
                  Error
                </Text>
                <Text textStyle="xs" color="red.500" whiteSpace="pre-wrap" wordBreak="break-word">
                  {entry.error}
                </Text>
              </Box>
            )}

            <HStack gap={2} flexWrap="wrap">
              {entry.projectionNames.map((name) => (
                <Badge key={name} size="sm" variant="subtle">
                  {name}
                </Badge>
              ))}
            </HStack>

            {entry.tenantIds.length > 0 && (
              <VStack align="stretch" gap={1}>
                <Text textStyle="xs" color="fg.muted">
                  Tenants
                </Text>
                <HStack gap={1} flexWrap="wrap">
                  {entry.tenantIds.map((id) => (
                    <Badge key={id} size="xs" variant="outline">
                      {id}
                    </Badge>
                  ))}
                </HStack>
              </VStack>
            )}
          </VStack>
        </Card.Body>
      </Card.Root>
    </VStack>
  );
}
