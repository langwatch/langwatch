/**
 * Banner displayed when scenario jobs are waiting in the queue.
 *
 * Shows the number of pending and active jobs so users know work is in progress.
 */

import { HStack, Spinner, Text } from "@chakra-ui/react";

interface QueueStatus {
  waiting: number;
  active: number;
}

interface QueueStatusBannerProps {
  queueStatus: QueueStatus | undefined;
}

export function QueueStatusBanner({ queueStatus }: QueueStatusBannerProps) {
  const waiting = queueStatus?.waiting ?? 0;
  const active = queueStatus?.active ?? 0;

  if (waiting === 0 && active === 0) return null;

  const parts: string[] = [];
  if (waiting > 0) parts.push(`${waiting} waiting`);
  if (active > 0) parts.push(`${active} running`);

  return (
    <HStack
      paddingX={4}
      paddingY={2}
      borderRadius="md"
      background="blue.50"
      borderWidth={1}
      borderColor="blue.200"
      gap={2}
    >
      <Spinner size="xs" color="blue.500" />
      <Text fontSize="sm" color="blue.700">
        {parts.join(", ")} — results will appear shortly
      </Text>
    </HStack>
  );
}
