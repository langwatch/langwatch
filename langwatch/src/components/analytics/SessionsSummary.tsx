import {
  Card,
  CardBody,
  CardHeader,
  HStack,
  Heading,
  Tooltip,
} from "@chakra-ui/react";
import { HelpCircle } from "react-feather";
import { api } from "../../utils/api";
import { usePublicEnv } from "../../hooks/usePublicEnv";
import { SummaryMetric } from "./SummaryMetric";
import { useFilterParams } from "../../hooks/useFilterParams";
import { QuickwitNote } from "./QuickwitNote";

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
    <Card overflow={"scroll"}>
      <CardHeader>
        <HStack>
          <Heading size="sm">User Sessions</Heading>
          <Tooltip label="A session is a period of user activity without breaks longer than one hour">
            <HelpCircle width="14px" />
          </Tooltip>
        </HStack>
      </CardHeader>
      <CardBody>
        {isNotQuickwit ? (
          <HStack spacing={0} align="stretch">
            <SummaryMetric
              label="Bouncing Rate"
              current={
                data
                  ? data.currentPeriod.bouncing_users_count /
                    (data.currentPeriod.total_users || 1)
                  : undefined
              }
              previous={
                data
                  ? data.previousPeriod.bouncing_users_count /
                    (data.previousPeriod.total_users || 1)
                  : undefined
              }
              format="0%"
              tooltip="Percentage of users who only sent a single message and never used it again"
              increaseIs="bad"
            />
            <SummaryMetric
              label="Returning Users"
              current={
                data
                  ? data.currentPeriod.returning_users_count /
                    (data.currentPeriod.total_users || 1)
                  : undefined
              }
              previous={
                data
                  ? data.previousPeriod.returning_users_count /
                    (data.previousPeriod.total_users || 1)
                  : undefined
              }
              format="0%"
              tooltip="Percentage of users who came back and initiated more than one session, hours appart"
            />
            <SummaryMetric
              label="Average Session Duration"
              current={
                data
                  ? data.currentPeriod.average_duration_per_user_session / 1000
                  : undefined
              }
              previous={
                data
                  ? data.previousPeriod.average_duration_per_user_session / 1000
                  : undefined
              }
              format="00:00:00"
            />
            <SummaryMetric
              label="Average Sessions per User"
              current={data?.currentPeriod.average_sessions_per_user}
              previous={data?.previousPeriod.average_sessions_per_user}
            />
            <SummaryMetric
              label="Average Threads per Session"
              current={data?.currentPeriod.average_threads_per_user_session}
              previous={data?.previousPeriod.average_threads_per_user_session}
            />
          </HStack>
        ) : isQuickwit ? (
          <QuickwitNote />
        ) : null}
      </CardBody>
    </Card>
  );
};
