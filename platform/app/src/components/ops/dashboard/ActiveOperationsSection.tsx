import { Text } from "@chakra-ui/react";
import { ActiveOperationsSection as ActiveOperationsSectionView } from "@langwatch/ops-web";
import type { DashboardData } from "@langwatch/ops-contract";
import { useReplayStatus } from "~/hooks/useReplayStatus";
import NextLink from "~/utils/compat/next-link";

export function ActiveOperationsSection({ data }: { data: DashboardData }) {
  const statusQuery = useReplayStatus();

  return (
    <ActiveOperationsSectionView
      pausedKeys={data.pausedKeys}
      replayStatus={statusQuery.data}
      renderProgressLink={(runId) => (
        <NextLink href={`/ops/projections/${runId}`} style={{ textDecoration: "none" }}>
          <Text textStyle="xs" color="blue.500" cursor="pointer">
            View progress
          </Text>
        </NextLink>
      )}
    />
  );
}
