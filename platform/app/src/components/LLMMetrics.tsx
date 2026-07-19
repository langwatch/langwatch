import {
  Card,
  Grid,
  GridItem,
  Heading,
  HStack,
  IconButton,
  Tabs,
} from "@chakra-ui/react";
import { ArrowUpRight } from "lucide-react";
import { useOrganizationTeamProject } from "../hooks/useOrganizationTeamProject";
import { analyticsMetrics } from "../server/analytics/registry";
import { CustomGraph, type CustomGraphInput } from "./analytics/CustomGraph";
import { LLMSummary } from "./analytics/LLMSummary";
import { Link } from "./ui/link";
import { Tooltip } from "./ui/tooltip";

// Time unit conversion constants
const MINUTES_IN_DAY = 24 * 60; // 1440 minutes in a day
const ONE_DAY = MINUTES_IN_DAY;

export function LLMMetrics() {
  const { hasPermission, project } = useOrganizationTeamProject();

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
        <Heading as="h2" size="md">
          LLM Metrics
        </Heading>
        <Tooltip content="View LLM Metrics dashboard">
          <Link href={`/${project?.slug}/analytics/metrics`}>
            <IconButton
              aria-label="View LLM Metrics"
              variant="ghost"
              size="xs"
              color="fg.subtle"
            >
              <ArrowUpRight size={14} />
            </IconButton>
          </Link>
        </Tooltip>
      </HStack>
      <Grid width="100%" templateColumns="1fr 0.5fr" gap={6}>
        <GridItem colSpan={2}>
          <Card.Root>
            <Card.Body>
              <Tabs.Root variant="plain" defaultValue="llmCallsGraph">
                <Tabs.List gap={12}>
                  <Tabs.Trigger
                    value="llmCallsGraph"
                    paddingX={0}
                    paddingBottom={4}
                  >
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
                    <Tabs.Trigger
                      value="totalCostGraph"
                      paddingX={0}
                      paddingBottom={4}
                    >
                      <CustomGraph
                        input={{ ...totalCostGraph, graphType: "summary" }}
                        titleProps={{
                          textStyle: "sm",
                          color: "fg",
                        }}
                      />
                    </Tabs.Trigger>
                  )}
                  <Tabs.Trigger
                    value="tokensGraph"
                    paddingX={0}
                    paddingBottom={4}
                  >
                    <CustomGraph
                      input={totalTokensSummary}
                      titleProps={{
                        textStyle: "sm",
                        color: "fg",
                      }}
                    />
                  </Tabs.Trigger>
                  <Tabs.Indicator
                    mt="-1.5px"
                    height="4px"
                    bg="orange.400"
                    borderRadius="1px"
                    bottom={0}
                  />
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
            </Card.Body>
          </Card.Root>
        </GridItem>
        <GridItem>
          <LLMSummary />
        </GridItem>
        <GridItem>
          <Card.Root height="full">
            <Card.Header>
              <HStack gap={1}>
                <Heading size="sm">Evaluations Summary</Heading>
                <Tooltip content="View Online Evaluations">
                  <Link href={`/${project?.slug}/analytics/evaluations`}>
                    <IconButton
                      aria-label="View Evaluations"
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
              <CustomGraph
                input={{
                  ...evaluationsSummary,
                  graphType: "summary",
                }}
              />
            </Card.Body>
          </Card.Root>
        </GridItem>
        <GridItem>
          <Card.Root height="full">
            <Card.Header>
              <Heading size="sm">Error Trend</Heading>
            </Card.Header>
            <Card.Body>
              <CustomGraph input={errorTrend} />
            </Card.Body>
          </Card.Root>
        </GridItem>
        <GridItem>
          <Card.Root height="full">
            <Card.Header>
              <Heading size="sm">Latency Trend</Heading>
            </Card.Header>
            <Card.Body>
              <CustomGraph input={latencyTrend} />
            </Card.Body>
          </Card.Root>
        </GridItem>
      </Grid>
    </>
  );
}
