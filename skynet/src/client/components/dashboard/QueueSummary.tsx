import { HStack, Badge } from "@chakra-ui/react";
import type { QueueInfo } from "../../../shared/types.ts";

export function QueueSummary({ queue }: { queue: QueueInfo }) {
  return (
    <HStack spacing={2}>
      <Badge bg="badge.neutral" color="badge.neutral.text" fontSize="11px" borderRadius="2px">{queue.totalPendingJobs} jobs</Badge>
      <Badge bg="badge.pending" color="badge.pending.text" fontSize="11px" borderRadius="2px">{queue.pendingGroupCount} pending</Badge>
      {queue.blockedGroupCount > 0 && (
        <Badge bg="badge.blocked" color="badge.blocked.text" fontSize="11px" borderRadius="2px">{queue.blockedGroupCount} blocked</Badge>
      )}
      <Badge bg="badge.active" color="badge.active.text" fontSize="11px" borderRadius="2px">{queue.activeGroupCount} active</Badge>
    </HStack>
  );
}
