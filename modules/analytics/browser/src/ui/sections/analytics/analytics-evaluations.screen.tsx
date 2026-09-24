import { Alert, Box, Card, GridItem, Heading, HStack, SimpleGrid, Text } from "@chakra-ui/react";
import { getEvaluatorDefinitions } from "@langwatch/evaluator-contract";
import { BarChart2 } from "lucide-react";
import { Fragment, useCallback } from "react";

import { analyticsApi } from "../../../behavior/analytics-api.ts";
import { useAnalyticsHost } from "../../../model/analytics-host.ts";
import { Link } from "../../../ui/elements/analytics-link.tsx";
import AnalyticsLayout from "../../../ui/sections/analytics-layout.tsx";
import { CustomGraph, type CustomGraphInput } from "../../../ui/sections/custom-graph.tsx";
import { FilterSidebar } from "../../../ui/sections/filter-sidebar.tsx";

// Time unit conversion constants
const MINUTES_IN_DAY = 24 * 60; // 1440 minutes in a day
const ONE_DAY = MINUTES_IN_DAY;

const aggregateHealthSummary: CustomGraphInput = {
  graphId: "evaluationsHealthSummary",
  graphType: "summary",
  series: [
    {
      name: "Total evaluation runs",
      metric: "evaluations.evaluation_runs",
      aggregation: "cardinality",
      key: "",
      colorSet: "tealTones",
    },
  ],
  includePrevious: true,
  timeScale: ONE_DAY,
  height: 200,
};

const aggregatePassFailTrend: CustomGraphInput = {
  graphId: "evaluationsPassFailTrend",
  graphType: "stacked_bar",
  series: [
    {
      name: "Online evaluations",
      metric: "evaluations.evaluation_runs",
      aggregation: "cardinality",
      key: "",
      colorSet: "positiveNegativeNeutral",
    },
  ],
  groupBy: "evaluations.evaluation_passed",
  includePrevious: false,
  timeScale: ONE_DAY,
  height: 200,
};

const renderGridItems = (
  checks: any,
  onGraphClick: (params: {
    evaluatorId: string;
    groupKey?: string;
    date?: string;
    startDate?: string;
    endDate?: string;
    checkType: string;
    isGuardrail: boolean;
  }) => void,
) => {
  return checks.map((check: any) => {
    // Both are assigned in every branch below; declared without an initialiser
    // so a branch that forgot one is a compile error rather than an empty card.
    let checksAverage: CustomGraphInput | Record<string, never>;
    let checksSummary: CustomGraphInput | Record<string, never>;
    let passRateTrend: CustomGraphInput | null = null;
    const traceCheck = getEvaluatorDefinitions(check.checkType);

    const isCategoryEvaluator = check.checkType === "langevals/llm_category";

    if (traceCheck?.isGuardrail) {
      // Boolean/guardrail evaluators: show pass/fail distribution
      // Filter to only show processed evaluations (exclude error, scheduled, etc.)
      checksSummary = {
        graphId: `evalSummary_${check.id}`,
        graphType: "donnut",
        series: [
          {
            name: "Checks count",
            colorSet: "positiveNegativeNeutral",
            metric: "evaluations.evaluation_runs",
            aggregation: "cardinality",
            key: check.id,
            filters: {
              "evaluations.state": {
                [check.id]: ["processed"],
              },
            },
          },
        ],
        groupBy: "evaluations.evaluation_passed",
        groupByKey: check.id,
        includePrevious: false,
        timeScale: ONE_DAY,
        height: 300,
      };

      checksAverage = {
        graphId: `evalTimeline_${check.id}`,
        graphType: "stacked_bar",
        series: [
          {
            name: "",
            colorSet: "positiveNegativeNeutral",
            metric: "evaluations.evaluation_runs",
            aggregation: "cardinality",
            pipeline: {
              field: "trace_id",
              aggregation: "sum",
            },
            key: check.id,
            filters: {
              "evaluations.state": {
                [check.id]: ["processed"],
              },
            },
          },
        ],
        groupBy: "evaluations.evaluation_passed",
        groupByKey: check.id,
        includePrevious: false,
        timeScale: ONE_DAY,
        height: 300,
      };

      passRateTrend = {
        graphId: `evalPassRate_${check.id}`,
        graphType: "line",
        series: [
          {
            name: "Pass rate",
            colorSet: "tealTones",
            metric: "evaluations.evaluation_pass_rate",
            aggregation: "avg",
            key: check.id,
            filters: {
              "evaluations.state": {
                [check.id]: ["processed"],
              },
            },
          },
        ],
        includePrevious: false,
        timeScale: ONE_DAY,
        height: 200,
      };
    } else if (isCategoryEvaluator) {
      // Category evaluators: show category distribution
      // Filter to only show processed evaluations (exclude error, scheduled, etc.)
      checksSummary = {
        graphId: `evalSummary_${check.id}`,
        graphType: "donnut",
        series: [
          {
            name: "Traces count",
            colorSet: "colors",
            metric: "metadata.trace_id",
            aggregation: "cardinality",
            filters: {
              "evaluations.state": {
                [check.id]: ["processed"],
              },
            },
          },
        ],
        groupBy: "evaluations.evaluation_label",
        groupByKey: check.id,
        includePrevious: false,
        timeScale: ONE_DAY,
        height: 400,
      };

      checksAverage = {
        graphId: `evalTimeline_${check.id}`,
        graphType: "horizontal_bar",
        series: [
          {
            name: "",
            colorSet: "colors",
            metric: "metadata.trace_id",
            aggregation: "cardinality",
            filters: {
              "evaluations.state": {
                [check.id]: ["processed"],
              },
            },
          },
        ],
        groupBy: "evaluations.evaluation_label",
        groupByKey: check.id,
        includePrevious: false,
        timeScale: "full",
        height: 400,
      };
    } else {
      // Score-based evaluators: show average score
      // Filter to only show processed evaluations (exclude error, scheduled, etc.)
      checksSummary = {
        graphId: `evalSummary_${check.id}`,
        graphType: "summary",
        series: [
          {
            name: "Evaluation score average",
            colorSet: "tealTones",
            metric: "evaluations.evaluation_score",
            aggregation: "avg",
            key: check.id,
            filters: {
              "evaluations.state": {
                [check.id]: ["processed"],
              },
            },
          },
        ],
        includePrevious: false,
        timeScale: ONE_DAY,
        height: 200,
      };

      checksAverage = {
        graphId: `evalTimeline_${check.id}`,
        graphType: "line",
        series: [
          {
            name: "Average score",
            colorSet: "colors",
            metric: "evaluations.evaluation_score",
            aggregation: "avg",
            key: check.id,
            filters: {
              "evaluations.state": {
                [check.id]: ["processed"],
              },
            },
          },
        ],
        includePrevious: false,
        timeScale: ONE_DAY,
        height: 200,
      };
    }

    return (
      <Fragment key={check.id}>
        <GridItem colSpan={1} display="inline-grid">
          <Card.Root>
            <Card.Header>
              <HStack gap={2}>
                <BarChart2 color="orange" />
                <Heading size="sm">{check.name}</Heading>
              </HStack>
              {!check.enabled && (
                <Text color="gray" fontSize="sm">
                  (disabled)
                </Text>
              )}
            </Card.Header>
            <Card.Body>
              <CustomGraph
                input={checksSummary as CustomGraphInput}
                onDataPointClick={(params) => {
                  onGraphClick({
                    evaluatorId: check.id,
                    groupKey: params.groupKey,
                    checkType: check.checkType,
                    isGuardrail: traceCheck?.isGuardrail ?? false,
                  });
                }}
              />
            </Card.Body>
          </Card.Root>
        </GridItem>
        <GridItem colSpan={3} display="inline-grid">
          <Card.Root>
            <Card.Header>
              <HStack gap={2}>
                <BarChart2 color="orange" />
                <Heading size="sm">{check.name}</Heading>
                {traceCheck && <Text fontWeight={300}>- {traceCheck.name}</Text>}
              </HStack>
              {!check.enabled && (
                <Text color="gray" fontSize="sm">
                  (disabled)
                </Text>
              )}
            </Card.Header>
            <Card.Body>
              <CustomGraph
                input={checksAverage as CustomGraphInput}
                onDataPointClick={(params) => {
                  onGraphClick({
                    evaluatorId: check.id,
                    groupKey: params.groupKey,
                    date: params.date,
                    startDate: params.startDate,
                    endDate: params.endDate,
                    checkType: check.checkType,
                    isGuardrail: traceCheck?.isGuardrail ?? false,
                  });
                }}
              />
            </Card.Body>
          </Card.Root>
        </GridItem>
        {passRateTrend && (
          <GridItem colSpan={4} display="inline-grid">
            <Card.Root>
              <Card.Header>
                <HStack gap={2}>
                  <BarChart2 color="orange" />
                  <Heading size="sm">{check.name} - Pass Rate Trend</Heading>
                </HStack>
              </Card.Header>
              <Card.Body>
                <CustomGraph input={passRateTrend} />
              </Card.Body>
            </Card.Root>
          </GridItem>
        )}
      </Fragment>
    );
  });
};

interface GraphClickParams {
  evaluatorId: string;
  groupKey?: string;
  date?: string;
  startDate?: string;
  endDate?: string;
  checkType: string;
  isGuardrail: boolean;
}

function traceExplorerQuery(params: GraphClickParams): string {
  const isCategoryEvaluator = params.checkType === "langevals/llm_category";

  // Build filter parameters using dot notation with evaluator ID as key
  // Format: evaluation_passed.{evaluatorId}=0|1 and evaluation_run.{evaluatorId}=processed
  const filterParams: Record<string, string | string[]> = {
    [`evaluation_run.${params.evaluatorId}`]: ["processed"], // Excludes error/scheduled
  };

  // Add appropriate filter based on evaluator type. status="processed" is filtered
  // first to exclude error/scheduled, then the specific filter (passed/label) is added.
  if (params.isGuardrail && params.groupKey) {
    // For guardrail evaluators, filter by passed/failed. groupKey comes from the graph
    // and can be "passed", "failed", "1", "0", "true", "false", "positive", "negative"
    const passed =
      params.groupKey === "passed" ||
      params.groupKey === "true" ||
      params.groupKey === "positive" ||
      params.groupKey === "1";
    const failed =
      params.groupKey === "failed" ||
      params.groupKey === "false" ||
      params.groupKey === "negative" ||
      params.groupKey === "0";

    if (passed) {
      filterParams[`evaluation_passed.${params.evaluatorId}`] = "1";
    } else if (failed) {
      filterParams[`evaluation_passed.${params.evaluatorId}`] = "0";
    }
  } else if (isCategoryEvaluator && params.groupKey) {
    // For category evaluators, filter by label
    filterParams[`evaluation_label.${params.evaluatorId}`] = params.groupKey;
  }

  // Add date range filter if provided (for bar chart drill-down)
  if (params.startDate && params.endDate) {
    filterParams.startDate = params.startDate;
    filterParams.endDate = params.endDate;
  }

  // Navigate to the Trace Explorer with query parameters. A whole address
  // rather than a merge: none of this page's parameters mean anything on
  // the trace explorer.
  return Object.entries(filterParams)
    .map(
      ([key, value]) =>
        `${encodeURIComponent(key)}=${encodeURIComponent(
          Array.isArray(value) ? value.join(",") : value,
        )}`,
    )
    .join("&");
}

function EvaluationsContent() {
  const host = useAnalyticsHost();
  const project = host.project();
  const checks = analyticsApi.monitors.getAllForProject.useQuery(
    {
      projectId: project?.id ?? "",
    },
    { enabled: !!project },
  );
  const selectedEvaluationId = host.route().query.evaluationId;
  const selectedEvaluation = checks.data?.find((check) => check.id === selectedEvaluationId);
  const visibleChecks = selectedEvaluation ? [selectedEvaluation] : (checks.data ?? []);

  const handleGraphClick = useCallback(
    (params: GraphClickParams) => {
      if (!project || !params.evaluatorId) {
        return;
      }
      host.navigate(`/${project.slug}/traces?${traceExplorerQuery(params)}`);
    },
    [project, host],
  );

  return (
    <AnalyticsLayout title="Online Evaluations" railEntry="evaluations">
      {checks.data && checks.data?.length === 0 && (
        <Alert.Root
          colorPalette="warning"
          borderStartWidth="4px"
          borderStartColor="colorPalette.solid"
          marginBottom={6}
        >
          <Alert.Indicator />
          <Alert.Content>
            <Alert.Title>No online evaluations yet</Alert.Title>
            <Alert.Description>
              <Text as="span">Online evaluation results will be displayed here. </Text>
              <Link href={`/${project?.slug}/online-evaluations`}>Set up an online evaluation</Link>
              <Text as="span"> to see results for your project.</Text>
            </Alert.Description>
          </Alert.Content>
        </Alert.Root>
      )}
      {selectedEvaluation && (
        <Alert.Root colorPalette="blue" marginBottom={6}>
          <Alert.Indicator />
          <Alert.Content>
            <Alert.Title>{selectedEvaluation.name}</Alert.Title>
            <Alert.Description>
              Showing analytics for this online evaluation.{" "}
              <Link href={`/${project?.slug}/analytics/evaluations`}>
                View all online evaluations
              </Link>
            </Alert.Description>
          </Alert.Content>
        </Alert.Root>
      )}
      <HStack alignItems="start" gap={4}>
        <SimpleGrid templateColumns="repeat(4, 1fr)" gap={5} width="100%">
          {visibleChecks.length > 0 && !selectedEvaluation && (
            <>
              <GridItem colSpan={1} display="inline-grid">
                <Card.Root>
                  <Card.Header>
                    <Heading size="sm">Overall Health</Heading>
                  </Card.Header>
                  <Card.Body>
                    <CustomGraph input={aggregateHealthSummary} />
                  </Card.Body>
                </Card.Root>
              </GridItem>
              <GridItem colSpan={3} display="inline-grid">
                <Card.Root>
                  <Card.Header>
                    <Heading size="sm">Pass / Fail Trend</Heading>
                  </Card.Header>
                  <Card.Body>
                    <CustomGraph input={aggregatePassFailTrend} />
                  </Card.Body>
                </Card.Root>
              </GridItem>
            </>
          )}
          {visibleChecks.length > 0
            ? renderGridItems(
                [...visibleChecks].toSorted((a, b) => {
                  // Enabled items first (true > false when comparing booleans)
                  if (a.enabled === b.enabled) return 0;
                  return a.enabled ? -1 : 1;
                }),
                handleGraphClick,
              )
            : null}
        </SimpleGrid>
        <Box padding={3}>
          <FilterSidebar hideTopics={true} />
        </Box>
      </HStack>
    </AnalyticsLayout>
  );
}

/**
 * The page guard is the routes section's, not this module's: permission
 * gating and layout chrome are stated once in `analytics-routes.tsx`, in
 * front of the loader registry these screens are children of.
 */
export default EvaluationsContent;
