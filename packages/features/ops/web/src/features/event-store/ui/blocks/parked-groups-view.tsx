import { Box, HStack, Spinner, Text } from "@chakra-ui/react";
import type { ParkedGroupInfo } from "@langwatch/ops-contract";
import { formatCount, formatTimeAgo } from "../../../../model/ops-formatters";
import { middleEllipsis } from "../../../../model/queue-cluster-groups";

export function ParkedGroupsView({
  isLoading,
  isError,
  groups,
  total,
}: {
  isLoading: boolean;
  isError: boolean;
  groups: ParkedGroupInfo[];
  total: number;
}) {
  if (isLoading) {
    return (
      <HStack paddingX={6} paddingY={3} gap={2}>
        <Spinner size="xs" />
        <Text textStyle="xs" color="fg.muted">
          Loading parked groups
        </Text>
      </HStack>
    );
  }

  // A failed read is not an empty result. Rendering "nothing is parked any
  // more" over an error tells the operator the problem resolved itself during
  // the incident that broke the query.
  if (isError) {
    return (
      <Text textStyle="xs" color="red.500" paddingX={6} paddingY={3}>
        Could not load this tenant's parked groups. The count above still stands — do not
        read this as cleared.
      </Text>
    );
  }

  if (groups.length === 0) {
    return (
      <Text textStyle="xs" color="fg.muted" paddingX={6} paddingY={3}>
        This tenant dropped below its limit — nothing is parked any more.
      </Text>
    );
  }

  return (
    <Box paddingX={6} paddingY={2} background="bg.subtle">
      {total > groups.length && (
        <Text textStyle="xs" color="fg.muted" paddingBottom={1}>
          Showing {groups.length} of {formatCount(total)} parked groups
        </Text>
      )}
      {groups.map((group) => (
        <HStack key={group.groupId} gap={3} paddingY={1}>
          <Text fontFamily="mono" textStyle="xs" title={group.groupId} flex="1" truncate>
            {middleEllipsis(group.groupId, 64)}
          </Text>
          <Text textStyle="xs" color="fg.muted">
            {group.pipelineName ?? "—"}
          </Text>
          <Text textStyle="xs" color="fg.muted" minWidth="70px">
            {group.pendingJobs} pending
          </Text>
          <Text textStyle="xs" color="fg.muted" minWidth="70px">
            {formatTimeAgo(group.oldestJobMs)}
          </Text>
        </HStack>
      ))}
    </Box>
  );
}
