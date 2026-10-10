import { Card, Heading, HStack, IconButton } from "@langwatch/design-system/primitives";
import { Tooltip } from "@langwatch/design-system/tooltip";
import { ArrowUpRight } from "lucide-react";

import { useAnalyticsHost } from "../../model/analytics-host.ts";
import { analyticsMetrics } from "../../model/analytics-registry.ts";
import { Link } from "../elements/analytics-link.tsx";
import { CustomGraph, type CustomGraphInput } from "./custom-graph.tsx";

export const LLMSummary = () => {
  const host = useAnalyticsHost();
  const project = host.project();
  const hasPermission = (permission: string) => host.hasPermission(permission);

  const llmSummary: CustomGraphInput = {
    graphId: "llmSummary",
    graphType: "summary",
    series: [
      {
        name: "Mean tokens per message",
        metric: "performance.total_tokens",
        aggregation: "avg",
        colorSet: analyticsMetrics.performance.total_tokens.colorSet,
      },
      ...(hasPermission("cost:view")
        ? ([
            {
              name: "Mean cost per message",
              metric: "performance.total_cost",
              aggregation: "avg",
              colorSet: analyticsMetrics.performance.total_cost.colorSet,
            },
          ] as CustomGraphInput["series"])
        : []),
      {
        name: "P90 time to first token",
        metric: "performance.first_token",
        aggregation: "p90",
        colorSet: analyticsMetrics.performance.first_token.colorSet,
      },
      {
        name: "P90 completion time",
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
          <Heading textStyle="cardTitle">Summary</Heading>
          {project?.slug && (
            <Tooltip content="View LLM metrics">
              <Link href={`/${project.slug}/analytics/metrics`}>
                <IconButton
                  aria-label="View LLM metrics"
                  variant="ghost"
                  size="2xs"
                  color="fg.subtle"
                >
                  <ArrowUpRight size={14} />
                </IconButton>
              </Link>
            </Tooltip>
          )}
        </HStack>
      </Card.Header>
      <Card.Body>
        <CustomGraph input={llmSummary} />
      </Card.Body>
    </Card.Root>
  );
};
