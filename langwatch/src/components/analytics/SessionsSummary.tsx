import { Card, HStack, Heading } from "@chakra-ui/react";
import { HelpCircle } from "react-feather";
import { api } from "../../utils/api";
import { usePublicEnv } from "../../hooks/usePublicEnv";
import { SummaryMetric } from "./SummaryMetric";
import { useFilterParams } from "../../hooks/useFilterParams";
import { QuickwitNote } from "./QuickwitNote";
import { Tooltip } from "../ui/tooltip";

export const SessionsSummary = () => {
  const publicEnv = usePublicEnv();
  const isNotQuickwit = publicEnv.data && !publicEnv.data.IS_QUICKWIT;
  const isQuickwit = publicEnv.data && publicEnv.data.IS_QUICKWIT;

  const { filterParams, queryOpts } = useFilterParams();

  const { data } = api.analytics.sessionsVsPreviousPeriod.useQuery(
    filterParams,
    queryOpts
  );

  return (
    <Card.Root overflow="scroll">
      <Card.Header>
        <HStack gap={2}>
          <Heading size="sm">User Sessions</Heading>
          <Tooltip content="A session is a period of user activity without breaks longer than one hour">
            <HelpCircle width="14px" />
          </Tooltip>
        </HStack>
      </Card.Header>
      <Card.Body>
        {isNotQuickwit ? (
          <HStack gap={0} align="stretch">
            <SummaryMetric
              label="Average Duration"
              current={
                data
                  ? data.currentPeriod.average_duration_per_session
                  : undefined
              }
              previous={
                data
                  ? data.previousPeriod.average_duration_per_session
                  : undefined
              }
              format="00:00:00"
            />
            <SummaryMetric
              label="Average per User"
              current={data?.currentPeriod.average_sessions_per_user}
              previous={data?.previousPeriod.average_sessions_per_user}
            />
            <SummaryMetric
              label="Average Threads per Session"
              current={data?.currentPeriod.average_interactions_per_session}
              previous={data?.previousPeriod.average_interactions_per_session}
            />
          </HStack>
        ) : isQuickwit ? (
          <QuickwitNote />
        ) : null}
      </Card.Body>
    </Card.Root>
  );
};
