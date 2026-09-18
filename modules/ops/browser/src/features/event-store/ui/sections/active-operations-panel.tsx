import { Text } from "@chakra-ui/react";
import type { DashboardData } from "@langwatch/ops-contract";

import { OpsNextLink as NextLink } from "../../../../ui/elements/ops-link.tsx";
import { useReplayStatus } from "../../behavior/use-replay-status.ts";
import { ActiveOperationsSection as ActiveOperationsSectionView } from "../elements/active-operations-section.tsx";

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
