import { useRouter } from "next/router";
import { Badge, Button, Card, HStack, Status, Text } from "@chakra-ui/react";
import { api } from "~/utils/api";
import { useOpsPermission } from "~/hooks/useOpsPermission";
import { useReplayStatus } from "~/hooks/useReplayStatus";

export function ReplayStatusBanner() {
  const router = useRouter();
  const statusQuery = useReplayStatus();
  const cancelMutation = api.ops.cancelReplay.useMutation({
    onSuccess: () => void statusQuery.refetch(),
  });
  const { hasAccess: canManage } = useOpsPermission();

  const status = statusQuery.data;
  // Only show banner while actively running
  if (!status || status.state !== "running") return null;

  return (
    <Card.Root borderColor="blue.200" borderWidth="1px">
      <Card.Body padding={4}>
        <HStack justify="space-between">
          <HStack gap={2}>
            <Status.Root colorPalette="blue">
              <Status.Indicator />
            </Status.Root>
            <Text textStyle="sm" fontWeight="semibold">
              Replay running
            </Text>
            {status.currentProjection && (
              <Badge size="sm" variant="subtle">
                {status.currentProjection}
              </Badge>
            )}
          </HStack>
          <HStack gap={2}>
            {status.runId && (
              <Button
                size="xs"
                variant="outline"
                onClick={() =>
                  void router.push(`/ops/projections/${status.runId}`)
                }
              >
                View Progress
              </Button>
            )}
            {canManage && (
              <Button
                size="xs"
                colorPalette="red"
                variant="outline"
                loading={cancelMutation.isPending}
                onClick={() => cancelMutation.mutate()}
              >
                Cancel
              </Button>
            )}
          </HStack>
        </HStack>
      </Card.Body>
    </Card.Root>
  );
}
