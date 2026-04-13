import { Card, Heading, HStack, IconButton } from "@chakra-ui/react";
import { ArrowUpRight } from "lucide-react";
import { useOrganizationTeamProject } from "../../hooks/useOrganizationTeamProject";
import { analyticsMetrics } from "../../server/analytics/registry";
import { Link } from "../ui/link";
import { Tooltip } from "../ui/tooltip";
import { CustomGraph, type CustomGraphInput } from "./CustomGraph";

export const LLMSummary = () => {
  const { hasPermission, project } = useOrganizationTeamProject();

  const llmSummary: CustomGraphInput = {
    graphId: "llmSummary",
    graphType: "summary",
    series: [
      {
        name: "Mean Tokens per Message",
        metric: "performance.total_tokens",
        aggregation: "avg",
        colorSet: analyticsMetrics.performance.total_tokens.colorSet,
      },
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
        <HStack gap={1}>
          <Heading size="sm">Summary</Heading>
          <Tooltip content="View LLM Metrics">
            <Link href={`/${project?.slug}/analytics/metrics`}>
              <IconButton
                aria-label="View LLM Metrics"
                variant="ghost"
                size="2xs"
                color="fg.subtle"
              >
                <ArrowUpRight size={14} />
              </IconButton>
            </Link>
          </Tooltip>
        </HStack>
      </Card.Header>
      <Card.Body>
        <CustomGraph input={llmSummary} />
      </Card.Body>
    </Card.Root>
  );
};
