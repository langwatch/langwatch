import { Card, Heading } from "@chakra-ui/react";
import { useOrganizationTeamProject } from "../../hooks/useOrganizationTeamProject";
import { usePublicEnv } from "../../hooks/usePublicEnv";
import { analyticsMetrics } from "../../server/analytics/registry";
import { CustomGraph, type CustomGraphInput } from "./CustomGraph";

export const LLMSummary = () => {
  const publicEnv = usePublicEnv();
  const { hasPermission } = useOrganizationTeamProject();

  const isQuickwit = publicEnv.data?.IS_QUICKWIT;
  const isNotQuickwit = !isQuickwit;

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
                colorSet:
                  analyticsMetrics.performance.completion_tokens.colorSet,
              },
            ] as CustomGraphInput["series"])
          : []),
      ...(hasPermission("cost:view")
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
    <Card.Root>
      <Card.Header>
        <Heading size="sm">Summary</Heading>
      </Card.Header>
      <Card.Body>
        <CustomGraph input={llmSummary} />
      </Card.Body>
    </Card.Root>
  );
};
