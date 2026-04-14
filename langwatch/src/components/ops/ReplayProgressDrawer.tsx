import { useMemo } from "react";
import {
  Badge,
  Box,
  Button,
  HStack,
  Progress,
  Separator,
  Stat,
  Status,
  Text,
  VStack,
} from "@chakra-ui/react";
import { useRouter } from "next/router";
import {
  DrawerRoot,
  DrawerContent,
  DrawerHeader,
  DrawerBody,
  DrawerFooter,
  DrawerCloseTrigger,
  DrawerTitle,
} from "~/components/ui/drawer";
import { useOpsPermission } from "~/hooks/useOpsPermission";
import { useReplayStatus } from "~/hooks/useReplayStatus";
import { api } from "~/utils/api";
import { formatDuration } from "~/components/ops/shared/formatters";
import { PhaseTimeline, PHASE_ICONS, PHASE_LABELS } from "~/components/ops/shared/PhaseTimeline";

export function ReplayProgressDrawer({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const router = useRouter();
  const { canManage } = useOpsPermission();

  const statusQuery = useReplayStatus({
    refetchInterval: open ? 1000 : false,
  });

  const cancelMutation = api.ops.cancelReplay.useMutation({
    onSuccess: () => void statusQuery.refetch(),
  });

  const status = statusQuery.data;
  const isRunning = status?.state === "running";

  const stateColor =
    status?.state === "completed"
      ? "green"
      : status?.state === "failed"
        ? "red"
        : status?.state === "cancelled"
          ? "orange"
          : "blue";

  const progressPercent =
    status && status.aggregatesTotal > 0
      ? Math.round(
          (status.aggregatesProcessed / status.aggregatesTotal) * 100,
        )
      : 0;

  const throughputRate = useMemo(() => {
    if (!status?.startedAt || !status.eventsProcessed) return null;
    const elapsed = (Date.now() - new Date(status.startedAt).getTime()) / 1000;
    if (elapsed < 1) return null;
    return Math.round(status.eventsProcessed / elapsed);
  }, [status?.startedAt, status?.eventsProcessed]);

  return (
    <DrawerRoot
      open={open}
      onOpenChange={(e) => {
        if (!e.open) onClose();
      }}
      placement="end"
      size="sm"
    >
      <DrawerContent>
        <DrawerHeader>
          <DrawerTitle>
            <HStack gap={2}>
              <Status.Root colorPalette={stateColor} size="sm">
                <Status.Indicator />
              </Status.Root>
              Replay {status?.state ?? "idle"}
            </HStack>
          </DrawerTitle>
          <DrawerCloseTrigger />
        </DrawerHeader>
        <DrawerBody>
          {!status || status.state === "idle" ? (
            <Text textStyle="sm" color="fg.muted">
              No replay is currently running.
            </Text>
          ) : (
            <VStack align="stretch" gap={4}>
              {/* Phase timeline */}
              <PhaseTimeline
                currentPhase={status.currentPhase}
                completedState={status.state !== "running" ? status.state as "completed" | "failed" | "cancelled" : null}
              />

              {/* Current phase detail */}
              {status.currentPhase && (
                <HStack gap={2}>
                  <Text textStyle="lg">
                    {PHASE_ICONS[status.currentPhase] ?? "·"}
                  </Text>
                  <VStack align="start" gap={0}>
                    <Text textStyle="sm" fontWeight="medium">
                      {PHASE_LABELS[status.currentPhase] ?? status.currentPhase}
                    </Text>
                    {status.currentProjection && (
                      <Text textStyle="xs" color="fg.muted">
                        {status.currentProjection}
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
                      {status.aggregatesProcessed.toLocaleString()} / {status.aggregatesTotal.toLocaleString()} ({progressPercent}%)
                    </Text>
                  </HStack>
                  <Progress.Root
                    value={progressPercent}
                    size="sm"
                    colorPalette={stateColor}
                  >
                    <Progress.Track>
                      <Progress.Range />
                    </Progress.Track>
                  </Progress.Root>
                </VStack>
              )}

              <Separator />

              {/* Stats grid */}
              <HStack gap={4} flexWrap="wrap">
                <Stat.Root>
                  <Stat.Label>Events</Stat.Label>
                  <Stat.ValueText textStyle="lg">
                    {status.eventsProcessed.toLocaleString()}
                  </Stat.ValueText>
                </Stat.Root>
                <Stat.Root>
                  <Stat.Label>Projections</Stat.Label>
                  <Stat.ValueText textStyle="lg">
                    {status.projectionNames.length}
                  </Stat.ValueText>
                </Stat.Root>
                {throughputRate !== null && (
                  <Stat.Root>
                    <Stat.Label>Events/s</Stat.Label>
                    <Stat.ValueText textStyle="lg">
                      {throughputRate.toLocaleString()}
                    </Stat.ValueText>
                  </Stat.Root>
                )}
                <Stat.Root>
                  <Stat.Label>Elapsed</Stat.Label>
                  <Stat.ValueText textStyle="lg">
                    {status.startedAt ? formatDuration(status.startedAt) : "—"}
                  </Stat.ValueText>
                </Stat.Root>
              </HStack>

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
                      variant={name === status.currentProjection ? "solid" : "subtle"}
                      colorPalette={name === status.currentProjection ? "orange" : "gray"}
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
                <Box
                  padding={3}
                  borderRadius="md"
                  bg="red.subtle"
                  borderWidth="1px"
                  borderColor="red.200"
                >
                  <Text textStyle="xs" fontWeight="medium" color="red.fg" marginBottom={1}>
                    Error
                  </Text>
                  <Text textStyle="xs" color="red.fg">
                    {status.error}
                  </Text>
                </Box>
              )}
            </VStack>
          )}
        </DrawerBody>
        <DrawerFooter>
          <HStack gap={2} width="full">
            {status?.runId && (
              <Button
                size="sm"
                variant="outline"
                flex={1}
                onClick={() => {
                  void router.push(`/ops/projections/${status.runId}`);
                  onClose();
                }}
              >
                Full Page View
              </Button>
            )}
            {isRunning && canManage && (
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
        </DrawerFooter>
      </DrawerContent>
    </DrawerRoot>
  );
}
