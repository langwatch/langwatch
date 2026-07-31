import { Card, HStack, Spacer, Spinner, Text, VStack } from "@chakra-ui/react";
import { useMemo } from "react";
import { useOpsSSE } from "~/hooks/useOpsSSE";
import { api } from "~/utils/api";
import { AnomaliesCard } from "./AnomaliesCard";
import { BlockedCard } from "./BlockedCard";
import { DlqCard } from "./DlqCard";
import { GroupsCard } from "./GroupsCard";
import { PipelineTreeCard } from "./PipelineTreeCard";

export function QueuesContent() {
  const { data: sseData } = useOpsSSE();
  const snapshot = api.ops.getDashboardSnapshot.useQuery(undefined, {
    enabled: !sseData,
    refetchInterval: sseData ? false : 5000,
  });
  const data = sseData ?? snapshot.data ?? null;
  const queuesQuery = api.ops.listQueues.useQuery(undefined, {
    refetchInterval: 10000,
  });
  const queueNames = useMemo(
    () => (queuesQuery.data ?? []).map((q) => q.name),
    [queuesQuery.data],
  );

  return (
    <VStack align="stretch" gap={5}>
      {data ? (
        <PipelineTreeCard
          pipelineTree={data.pipelineTree}
          pausedKeys={data.pausedKeys}
          queueNames={queueNames}
        />
      ) : (
        <Card.Root>
          <Card.Body padding={0}>
            <HStack paddingX={4} paddingY={2.5}>
              <Text textStyle="sm" fontWeight="medium">
                Pipeline Tree
              </Text>
              <Spacer />
              <Spinner size="xs" />
            </HStack>
          </Card.Body>
        </Card.Root>
      )}
      <AnomaliesCard />
      <BlockedCard queueNames={queueNames} />
      <DlqCard queueNames={queueNames} />
      <GroupsCard queueNames={queueNames} />
    </VStack>
  );
}
