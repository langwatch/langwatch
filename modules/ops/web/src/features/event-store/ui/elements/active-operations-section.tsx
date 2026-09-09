import { Badge, Card, HStack, Spacer, Status, Text, VStack } from "@chakra-ui/react";
import type { ReactNode } from "react";

export interface OpsReplayStatus {
  state: string;
  currentProjection?: string | null;
  runId?: string | null;
}

export function ActiveOperationsSection({
  pausedKeys,
  replayStatus,
  renderProgressLink,
}: {
  pausedKeys: string[];
  replayStatus: OpsReplayStatus | null | undefined;
  renderProgressLink?: (runId: string) => ReactNode;
}) {
  const isReplayRunning = replayStatus?.state === "running";
  const hasPaused = pausedKeys.length > 0;

  if (!isReplayRunning && !hasPaused) return null;

  return (
    <Card.Root overflow="hidden">
      <Text
        textStyle="xs"
        fontWeight="medium"
        color="fg.muted"
        paddingX={4}
        paddingTop={3}
        paddingBottom={2}
      >
        Active Operations
      </Text>
      <VStack align="stretch" gap={0} paddingX={4} paddingBottom={3}>
        {isReplayRunning && replayStatus && (
          <HStack
            gap={2}
            paddingY={2}
            borderBottom={hasPaused ? "1px solid" : undefined}
            borderBottomColor="border"
          >
            <Status.Root colorPalette="blue" size="sm">
              <Status.Indicator />
            </Status.Root>
            <Text textStyle="sm" fontWeight="medium">
              Replay running
            </Text>
            {replayStatus.currentProjection && (
              <Badge size="sm" variant="subtle" colorPalette="blue">
                {replayStatus.currentProjection}
              </Badge>
            )}
            <Spacer />
            {replayStatus.runId && renderProgressLink?.(replayStatus.runId)}
          </HStack>
        )}
        {hasPaused && (
          <VStack align="stretch" gap={1} paddingY={2}>
            <Text textStyle="xs" color="fg.muted">
              Paused pipelines
            </Text>
            <HStack gap={2} flexWrap="wrap">
              {pausedKeys.map((key) => (
                <Badge key={key} size="sm" colorPalette="orange" variant="subtle">
                  {key}
                </Badge>
              ))}
            </HStack>
          </VStack>
        )}
      </VStack>
    </Card.Root>
  );
}
