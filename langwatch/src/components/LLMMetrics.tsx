import { Card, Grid, GridItem, Heading, Tabs, VStack } from "@chakra-ui/react";
import { useOrganizationTeamProject } from "../hooks/useOrganizationTeamProject";
import { analyticsMetrics } from "../server/analytics/registry";
import { TeamRoleGroup } from "../server/api/permission";
import { CustomGraph, type CustomGraphInput } from "./analytics/CustomGraph";
import { LLMSummary } from "./analytics/LLMSummary";
import { usePublicEnv } from "../hooks/usePublicEnv";

// Time unit conversion constants
const MINUTES_IN_DAY = 24 * 60; // 1440 minutes in a day
const ONE_DAY = MINUTES_IN_DAY;

export function LLMMetrics() {
  const publicEnv = usePublicEnv();
  const isNotQuickwit = publicEnv.data && !publicEnv.data.IS_QUICKWIT;
  const isQuickwit = publicEnv.data && publicEnv.data.IS_QUICKWIT;
  const { hasTeamPermission } = useOrganizationTeamProject();

  const llmCallsGraph: CustomGraphInput = {
    graphId: "llmCallsGraph",
    graphType: "area",
    series: [
      {
        name: "LLM Calls",
        metric: "metadata.span_type",
        key: "llm",
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

  const promptAndCompletionTokensSummary: CustomGraphInput = {
    graphId: "promptAndCompletionTokensSummary",
    graphType: "summary",
    series: [
      {
        name: "Prompt Tokens",
        metric: "performance.prompt_tokens",
        aggregation: "sum",
        colorSet: analyticsMetrics.performance.prompt_tokens.colorSet,
      },
      {
        name: "Completion Tokens",
        metric: "performance.completion_tokens",
        aggregation: "sum",
        colorSet: analyticsMetrics.performance.completion_tokens.colorSet,
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

  return (
    <>
      <Heading as="h1" size="lg" paddingTop={6} paddingBottom={2}>
        LLM Metrics
      </Heading>
      <Grid
        width="100%"
        templateColumns={isNotQuickwit ? "1fr 0.5fr" : "1fr"}
        gap={6}
      >
        <GridItem colSpan={isNotQuickwit ? 2 : undefined}>
          <Card.Root>
            <Card.Body>
              <Tabs.Root variant="plain" defaultValue="llmCallsGraph">
                <Tabs.List gap={12}>
                  {isNotQuickwit && (
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
                          fontSize: 16,
                          color: "black",
                        }}
                      />
                    </Tabs.Trigger>
                  )}
                  {hasTeamPermission(TeamRoleGroup.COST_VIEW) && (
                    <Tabs.Trigger
                      value="totalCostGraph"
                      paddingX={0}
                      paddingBottom={4}
                    >
                      <CustomGraph
                        input={{ ...totalCostGraph, graphType: "summary" }}
                        titleProps={{
                          fontSize: 16,
                          color: "black",
                        }}
                      />
                    </Tabs.Trigger>
                  )}
                  <Tabs.Trigger
                    value="tokensGraph"
                    paddingX={0}
                    paddingBottom={4}
                  >
                    <VStack align="start">
                      {isNotQuickwit ? (
                        <CustomGraph
                          input={totalTokensSummary}
                          titleProps={{
                            fontSize: 16,
                            color: "black",
                          }}
                        />
                      ) : isQuickwit ? (
                        <CustomGraph
                          input={promptAndCompletionTokensSummary}
                          titleProps={{
                            fontSize: 16,
                            color: "black",
                          }}
                        />
                      ) : (
                        <></>
                      )}
                    </VStack>
                  </Tabs.Trigger>
                  <Tabs.Indicator
                    mt="-1.5px"
                    height="4px"
                    bg="orange.400"
                    borderRadius="1px"
                    bottom={0}
                  />
                </Tabs.List>
                {isNotQuickwit && (
                  <Tabs.Content value="llmCallsGraph">
                    <CustomGraph input={llmCallsGraph} />
                  </Tabs.Content>
                )}
                {hasTeamPermission(TeamRoleGroup.COST_VIEW) && (
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
        {isNotQuickwit && (
          <GridItem>
            <Card.Root height="full">
              <Card.Header>
                <Heading size="sm">Evaluations Summary</Heading>
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
        )}
      </Grid>
    </>
  );
}
