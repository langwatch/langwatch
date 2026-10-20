import { Card } from "@langwatch/design-system/card";
import {
  Grid,
  GridItem,
  Heading,
  HStack,
  IconButton,
  Tabs,
} from "@langwatch/design-system/primitives";
import { Tooltip } from "@langwatch/design-system/tooltip";
import { ArrowUpRight } from "lucide-react";

import { useAnalyticsHost } from "../../model/analytics-host.ts";
import { analyticsMetrics } from "../../model/analytics-registry.ts";
import { Link } from "../elements/analytics-link.tsx";
import { CustomGraph, type CustomGraphInput } from "./custom-graph.tsx";
import { LLMSummary } from "./llm-summary.tsx";

// Time unit conversion constants
const MINUTES_IN_DAY = 24 * 60; // 1440 minutes in a day
const ONE_DAY = MINUTES_IN_DAY;

export function LLMMetrics() {
  const host = useAnalyticsHost();
  const project = host.project();
  const hasPermission = (permission: string) => host.hasPermission(permission);

  const llmCallsGraph: CustomGraphInput = {
    graphId: "llmCallsGraph",
    graphType: "area",
    series: [
      {
        name: "LLM Calls",
        metric: "metadata.trace_id",
        aggregation: "cardinality",
        colorSet: "colors",
      },
    ],
    groupBy: "metadata.model",
    includePrevious: false,
    timeScale: ONE_DAY,
  };

  const totalCostGraph: CustomGraphInput = {
    graphId: "totalCostGraph",
    graphType: "line",
    series: [
      {
        name: analyticsMetrics.performance.total_cost.label,
        metric: "performance.total_cost",
        aggregation: "sum",
        colorSet: analyticsMetrics.performance.total_cost.colorSet,
      },
    ],
    groupBy: undefined,
    includePrevious: true,
    timeScale: ONE_DAY,
  };

  const totalTokensSummary: CustomGraphInput = {
    graphId: "totalTokensSummary",
    graphType: "summary",
    series: [
      {
        name: "Tokens",
        metric: "performance.total_tokens",
        aggregation: "sum",
        colorSet: analyticsMetrics.performance.total_tokens.colorSet,
      },
    ],
    groupBy: undefined,
    includePrevious: false,
    timeScale: "full",
  };

  const tokensGraph: CustomGraphInput = {
    graphId: "tokensGraph",
    graphType: "stacked_bar",
    series: [
      {
        name: analyticsMetrics.performance.prompt_tokens.label,
        metric: "performance.prompt_tokens",
        aggregation: "sum",
        colorSet: analyticsMetrics.performance.prompt_tokens.colorSet,
      },
      {
        name: analyticsMetrics.performance.completion_tokens.label,
        metric: "performance.completion_tokens",
        aggregation: "sum",
        colorSet: analyticsMetrics.performance.completion_tokens.colorSet,
      },
    ],
    groupBy: undefined,
    includePrevious: false,
    timeScale: ONE_DAY,
  };

  const evaluationsSummary: CustomGraphInput = {
    graphId: "evaluationsSummary",
    graphType: "summary",
    series: [
      {
        name: "Evaluation execution count",
        metric: "evaluations.evaluation_runs",
        aggregation: "cardinality",
        key: "",
        colorSet: "colors",
      },
    ],
    groupBy: "evaluations.evaluation_passed",
    includePrevious: false,
    timeScale: "full",
  };

  const errorTrend: CustomGraphInput = {
    graphId: "overviewErrorTrend",
    graphType: "stacked_bar",
    series: [
      {
        name: "Traces",
        metric: "metadata.trace_id",
        aggregation: "cardinality",
        colorSet: "positiveNegativeNeutral",
      },
    ],
    groupBy: "error.has_error",
    includePrevious: false,
    timeScale: ONE_DAY,
  };

  const latencyTrend: CustomGraphInput = {
    graphId: "overviewLatencyTrend",
    graphType: "line",
    series: [
      {
        name: analyticsMetrics.performance.completion_time.label,
        metric: "performance.completion_time",
        aggregation: "median",
        colorSet: analyticsMetrics.performance.completion_time.colorSet,
      },
      {
        name: analyticsMetrics.performance.first_token.label,
        metric: "performance.first_token",
        aggregation: "median",
        colorSet: analyticsMetrics.performance.first_token.colorSet,
      },
    ],
    groupBy: undefined,
    includePrevious: false,
    timeScale: ONE_DAY,
  };

  return (
    <>
      <HStack paddingTop={6} paddingBottom={2}>
        <Heading as="h2" size="sm">
          LLM metrics
        </Heading>
        <Tooltip content="View LLM metrics dashboard">
          <Link href={`/${project?.slug}/analytics/metrics`}>
            <IconButton aria-label="View LLM metrics" variant="ghost" size="xs" color="fg.subtle">
              <ArrowUpRight size={14} />
            </IconButton>
          </Link>
        </Tooltip>
      </HStack>
      <Grid width="100%" templateColumns="1fr 0.5fr" gap={6}>
        <GridItem colSpan={2}>
          <Card padding="lg">
            <Tabs.Root
              variant="line"
              defaultValue="llmCallsGraph"
              // Every panel here is a read-only CustomGraph analytics
              // query with no user-entered state, so fully unmounting
              // inactive tabs is safe and avoids firing/holding queries
              // for graphs the user never looks at.
              lazyMount
              unmountOnExit
            >
              <Tabs.List gap={12}>
                <Tabs.Trigger value="llmCallsGraph" paddingX={0} paddingBottom={4}>
                  <CustomGraph
                    input={{
                      ...llmCallsGraph,
                      graphType: "summary",
                      groupBy: undefined,
                    }}
                    titleProps={{
                      textStyle: "sm",
                      color: "fg",
                    }}
                  />
                </Tabs.Trigger>
                {hasPermission("cost:view") && (
                  <Tabs.Trigger value="totalCostGraph" paddingX={0} paddingBottom={4}>
                    <CustomGraph
                      input={{ ...totalCostGraph, graphType: "summary" }}
                      titleProps={{
                        textStyle: "sm",
                        color: "fg",
                      }}
                    />
                  </Tabs.Trigger>
                )}
                <Tabs.Trigger value="tokensGraph" paddingX={0} paddingBottom={4}>
                  <CustomGraph
                    input={totalTokensSummary}
                    titleProps={{
                      textStyle: "sm",
                      color: "fg",
                    }}
                  />
                </Tabs.Trigger>
              </Tabs.List>
              <Tabs.Content value="llmCallsGraph">
                <CustomGraph input={llmCallsGraph} />
              </Tabs.Content>
              {hasPermission("cost:view") && (
                <Tabs.Content value="totalCostGraph">
                  <CustomGraph input={totalCostGraph} />
                </Tabs.Content>
              )}
              <Tabs.Content value="tokensGraph">
                <CustomGraph input={tokensGraph} />
              </Tabs.Content>
            </Tabs.Root>
          </Card>
        </GridItem>
        <GridItem>
          <LLMSummary />
        </GridItem>
        <GridItem>
          <Card
            variant="panel-fill"
            padding="lg"
            title="Evaluations summary"
            actions={
              <Tooltip content="View online evaluations">
                <Link href={`/${project?.slug}/analytics/evaluations`}>
                  <IconButton
                    aria-label="View evaluations"
                    variant="ghost"
                    size="2xs"
                    color="fg.subtle"
                  >
                    <ArrowUpRight size={14} />
                  </IconButton>
                </Link>
              </Tooltip>
            }
          >
            <CustomGraph
              input={{
                ...evaluationsSummary,
                graphType: "summary",
              }}
            />
          </Card>
        </GridItem>
        <GridItem>
          <Card variant="panel-fill" padding="lg" title="Error trend">
            <CustomGraph input={errorTrend} />
          </Card>
        </GridItem>
        <GridItem>
          <Card variant="panel-fill" padding="lg" title="Latency trend">
            <CustomGraph input={latencyTrend} />
          </Card>
        </GridItem>
      </Grid>
    </>
  );
}
