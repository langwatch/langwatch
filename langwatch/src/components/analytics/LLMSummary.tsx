import { Card, CardHeader, CardBody, HStack, Heading } from "@chakra-ui/react";
import { formatMilliseconds } from "../../utils/formatMilliseconds";
import { SummaryMetric } from "./SummaryMetric";
import { useAnalyticsParams } from "../../hooks/useAnalyticsParams";
import { api } from "../../utils/api";
import { useOrganizationTeamProject } from "../../hooks/useOrganizationTeamProject";
import { TeamRoleGroup } from "../../server/api/permission";

export const LLMSummary = () => {
  const { hasTeamPermission } = useOrganizationTeamProject();
  const { analyticsParams, queryOpts } = useAnalyticsParams();

  const summaryMetrics = api.analytics.getSummaryMetrics.useQuery(
    analyticsParams,
    queryOpts
  );

  return (
    <Card>
      <CardHeader>
        <Heading size="sm">Summary</Heading>
      </CardHeader>
      <CardBody>
        <HStack spacing={0}>
          <SummaryMetric
            label="Average Total Tokens per Message"
            current={summaryMetrics.data?.currentPeriod.avg_tokens_per_trace}
            previous={summaryMetrics.data?.previousPeriod.avg_tokens_per_trace}
            increaseIs="neutral"
          />
          {hasTeamPermission(TeamRoleGroup.COST_VIEW) && (
            <SummaryMetric
              label="Average Cost per Message"
              current={
                summaryMetrics.data?.currentPeriod
                  .avg_total_cost_per_1000_traces
              }
              previous={
                summaryMetrics.data?.previousPeriod
                  .avg_total_cost_per_1000_traces
              }
              format="$0.00a"
              increaseIs="bad"
            />
          )}
          {(!summaryMetrics.data ||
            summaryMetrics.data.currentPeriod
              .percentile_90th_time_to_first_token > 0) && (
            <SummaryMetric
              label="90th Percentile Time to First Token"
              current={
                summaryMetrics.data?.currentPeriod
                  .percentile_90th_time_to_first_token
              }
              previous={
                summaryMetrics.data?.previousPeriod
                  .percentile_90th_time_to_first_token
              }
              format={formatMilliseconds}
              increaseIs="bad"
            />
          )}
          <SummaryMetric
            label="90th Percentile Total Response Time"
            current={
              summaryMetrics.data &&
              (!!summaryMetrics.data.currentPeriod.percentile_90th_total_time_ms
                ? summaryMetrics.data.currentPeriod
                    .percentile_90th_total_time_ms
                : "-")
            }
            previous={
              summaryMetrics.data &&
              (!!summaryMetrics.data.previousPeriod
                .percentile_90th_total_time_ms
                ? summaryMetrics.data.previousPeriod
                    .percentile_90th_total_time_ms
                : undefined)
            }
            format={
              !summaryMetrics.data ||
              summaryMetrics.data?.currentPeriod.percentile_90th_total_time_ms
                ? formatMilliseconds
                : () => "-"
            }
            increaseIs="bad"
          />
        </HStack>
      </CardBody>
    </Card>
  );
};
