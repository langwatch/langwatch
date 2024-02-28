import { Card, CardHeader, CardBody, Heading } from "@chakra-ui/react";
import { useOrganizationTeamProject } from "../../hooks/useOrganizationTeamProject";
import { TeamRoleGroup } from "../../server/api/permission";
import { analyticsMetrics } from "../../server/analytics/registry";
import { CustomGraph, type CustomGraphInput } from "./CustomGraph";

export const LLMSummary = () => {
  const { hasTeamPermission } = useOrganizationTeamProject();

  const llmSummary: CustomGraphInput = {
    graphId: "llmSummary",
    graphType: "summary",
    series: [
      {
        name: "Average Tokens per Message",
        metric: "performance.total_tokens",
        aggregation: "avg",
        colorSet: analyticsMetrics.performance.total_tokens.colorSet,
      },
      ...(hasTeamPermission(TeamRoleGroup.COST_VIEW)
        ? ([
            {
              name: "Average Cost per Message",
              metric: "performance.total_cost",
              aggregation: "avg",
              colorSet: analyticsMetrics.performance.total_cost.colorSet,
            },
          ] as CustomGraphInput["series"])
        : []),
      {
        name: "90th Percentile Time to First Token",
        metric: "performance.first_token",
        aggregation: "p90",
        colorSet: analyticsMetrics.performance.first_token.colorSet,
      },
      {
        name: "90th Percentile Completion Time",
        metric: "performance.completion_time",
        aggregation: "p90",
        colorSet: analyticsMetrics.performance.completion_time.colorSet,
      },
    ],
    groupBy: undefined,
    includePrevious: false,
    timeScale: "full",
  };

  return (
    <Card>
      <CardHeader>
        <Heading size="sm">Summary</Heading>
      </CardHeader>
      <CardBody>
        <CustomGraph input={llmSummary} />
      </CardBody>
    </Card>
  );
};
