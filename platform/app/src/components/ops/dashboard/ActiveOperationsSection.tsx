import {
  Badge,
  Card,
  HStack,
  Spacer,
  Status,
  Text,
  VStack,
} from "@chakra-ui/react";
import { useReplayStatus } from "~/hooks/useReplayStatus";
import NextLink from "~/utils/compat/next-link";

/**
 * Long-running operations worth interrupting the dashboard for.
 *
 * Paused pipelines used to appear here too. The dispatch plane has no pause
 * key any more — pausing was a property of the plane that was replaced — so
 * there is nothing to list, and listing "no pipelines paused" would imply a
 * switch that does not exist.
 */
export function ActiveOperationsSection() {
  const statusQuery = useReplayStatus();

  const replayStatus = statusQuery.data;
  const isReplayRunning = replayStatus?.state === "running";

  if (!isReplayRunning) return null;

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
        {replayStatus && (
          <HStack gap={2} paddingY={2}>
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
            {replayStatus.runId && (
              <NextLink
                href={`/ops/projections/${replayStatus.runId}`}
                style={{ textDecoration: "none" }}
              >
                <Text textStyle="xs" color="blue.500" cursor="pointer">
                  View progress
                </Text>
              </NextLink>
            )}
          </HStack>
        )}
      </VStack>
    </Card.Root>
  );
}
