/**
 * Banner showing the number of pending (waiting) jobs in the BullMQ queue
 * for a suite run.
 *
 * Only shows waiting jobs -- active jobs emit `run_started` events to
 * ElasticSearch and appear in the normal run history list.
 *
 * Renders nothing when there are no waiting jobs.
 */

import { HStack, Spinner, Text } from "@chakra-ui/react";
import type { QueueStatus } from "~/server/suites/suite.service";

type QueueStatusBannerProps = {
  queueStatus: QueueStatus | undefined;
};

export function QueueStatusBanner({ queueStatus }: QueueStatusBannerProps) {
  if (!queueStatus) return null;

  const { waiting } = queueStatus;

  if (waiting === 0) return null;

  return (
    <HStack
      gap={2}
      paddingX={3}
      paddingY={2}
      borderRadius="md"
      bg="blue.50"
      _dark={{ bg: "blue.950" }}
    >
      <Spinner size="xs" data-testid="queue-status-spinner" />
      <Text fontSize="sm" color="blue.700" _dark={{ color: "blue.200" }}>
        {waiting} scenarios pending...
      </Text>
    </HStack>
  );
}
