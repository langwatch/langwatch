import { Text } from "@chakra-ui/react";
import { Link as RoutedLink } from "@langwatch/browser-host/link";
import type { DashboardData } from "@langwatch/ops-contract";

import { useReplayStatus } from "../../behavior/use-replay-status.ts";
import { ActiveOperationsSection as ActiveOperationsSectionView } from "../elements/active-operations-section.tsx";

export function ActiveOperationsSection({ data }: { data: DashboardData }) {
  const statusQuery = useReplayStatus();

  return (
    <ActiveOperationsSectionView
      pausedKeys={data.pausedKeys}
      replayStatus={statusQuery.data}
      renderProgressLink={(runId) => (
        <RoutedLink href={`/ops/projections/${runId}`} style={{ textDecoration: "none" }}>
          <Text textStyle="xs" color="blue.500" cursor="pointer">
            View progress
          </Text>
        </RoutedLink>
      )}
    />
  );
}
