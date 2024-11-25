import { Card, CardBody, CardHeader, Heading } from "@chakra-ui/react";
import { useOrganizationTeamProject } from "../../hooks/useOrganizationTeamProject";
import { analyticsMetrics } from "../../server/analytics/registry";
import { TeamRoleGroup } from "../../server/api/permission";
import { CustomGraph, type CustomGraphInput } from "./CustomGraph";
import { api } from "../../utils/api";

export const LLMSummary = () => {
  const env = api.publicEnv.useQuery({});
  const { hasTeamPermission } = useOrganizationTeamProject();

  const isQuickwit = env.data && env.data.IS_QUICKWIT;
  const isNotQuickwit = env.data && !env.data.IS_QUICKWIT;

  const llmSummary: CustomGraphInput = {
    graphId: "llmSummary",
    graphType: "summary",
    series: [
      ...(isNotQuickwit
        ? ([
            {
              name: "Mean Tokens per Message",
              metric: "performance.total_tokens",
              aggregation: "avg",
              colorSet: analyticsMetrics.performance.total_tokens.colorSet,
            },
          ] as CustomGraphInput["series"])
        : isQuickwit
        ? ([
            {
              name: "Mean Prompt Tokens per Message",
              metric: "performance.prompt_tokens",
              aggregation: "avg",
              colorSet: analyticsMetrics.performance.prompt_tokens.colorSet,
            },
            {
              name: "Mean Completion Tokens per Message",
              metric: "performance.completion_tokens",
              aggregation: "avg",
              colorSet: analyticsMetrics.performance.completion_tokens.colorSet,
            },
          ] as CustomGraphInput["series"])
        : []),
      ...(hasTeamPermission(TeamRoleGroup.COST_VIEW)
        ? ([
            {
              name: "Mean Cost per Message",
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
