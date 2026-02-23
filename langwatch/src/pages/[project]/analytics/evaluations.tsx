import {
  Alert,
  Box,
  Card,
  GridItem,
  Heading,
  HStack,
  SimpleGrid,
  Text,
} from "@chakra-ui/react";
import { BarChart2 } from "lucide-react";
import { useRouter } from "next/router";
import { useCallback } from "react";
import qs from "qs";
import {
  CustomGraph,
  type CustomGraphInput,
} from "~/components/analytics/CustomGraph";
import { FilterSidebar } from "~/components/filters/FilterSidebar";
import GraphsLayout from "~/components/GraphsLayout";
import { Link } from "~/components/ui/link";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { api } from "~/utils/api";
import { AnalyticsHeader } from "../../../components/analytics/AnalyticsHeader";
import { withPermissionGuard } from "../../../components/WithPermissionGuard";
import { getEvaluatorDefinitions } from "../../../server/evaluations/getEvaluator";

// Time unit conversion constants
const MINUTES_IN_DAY = 24 * 60; // 1440 minutes in a day
const ONE_DAY = MINUTES_IN_DAY;

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
    let checksAverage = {};
    let checksSummary = {};
    const traceCheck = getEvaluatorDefinitions(check.checkType);

    const isCategoryEvaluator = check.checkType === "langevals/llm_category";

    if (traceCheck?.isGuardrail) {
      // Boolean/guardrail evaluators: show pass/fail distribution
      // Filter to only show processed evaluations (exclude error, scheduled, etc.)
      checksSummary = {
        graphId: "custom",
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
        graphId: "custom",
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
    } else if (isCategoryEvaluator) {
      // Category evaluators: show category distribution
      // Filter to only show processed evaluations (exclude error, scheduled, etc.)
      checksSummary = {
        graphId: "custom",
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
        graphId: "custom",
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
        graphId: "custom",
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
        graphId: "custom",
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
      <>
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
                {traceCheck && (
                  <Text fontWeight={300}>- {traceCheck.name}</Text>
                )}
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
      </>
    );
  });
};

function EvaluationsContent() {
  const { project } = useOrganizationTeamProject();
  const router = useRouter();
  const checks = api.monitors.getAllForProject.useQuery(
    {
      projectId: project?.id ?? "",
    },
    { enabled: !!project },
  );

  const handleGraphClick = useCallback(
    (params: {
      evaluatorId: string;
      groupKey?: string;
      date?: string;
      startDate?: string;
      endDate?: string;
      checkType: string;
      isGuardrail: boolean;
    }) => {
      if (!project || !params.evaluatorId) {
        return;
      }

      const isCategoryEvaluator = params.checkType === "langevals/llm_category";

      // Build filter parameters using dot notation with evaluator ID as key
      // Format: evaluation_passed.{evaluatorId}=0|1 and evaluation_run.{evaluatorId}=processed
      const filterParams: Record<string, string | string[]> = {
        [`evaluation_run.${params.evaluatorId}`]: ["processed"], // Only show processed evaluations (excludes error, scheduled, etc.)
      };

      // Add appropriate filter based on evaluator type
      // Note: We filter by status="processed" first to exclude error/scheduled,
      // then add the specific filter (passed/label) which should only apply to processed evaluations
      if (params.isGuardrail && params.groupKey) {
        // For guardrail evaluators, filter by passed/failed
        // The groupKey comes from the graph which only shows processed evaluations with passed=true/false
        // groupKey can be "passed", "failed", "1", "0", "true", "false", "positive", "negative"
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

      // Navigate to messages page with query parameters
      void router.push(
        {
          pathname: `/${project.slug}/messages`,
          query: filterParams,
        },
        undefined,
        { shallow: false },
      );
    },
    [project, router],
  );

  return (
    <GraphsLayout title="Online Evaluations">
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
              <Text as="span">
                The evaluation results will be displayed here. Setup evaluations
                for your project to see the results. Click{" "}
              </Text>
              <Link href={`/${project?.slug}/evaluations`}>here</Link>
              <Text as="span"> to get started.</Text>
            </Alert.Description>
          </Alert.Content>
        </Alert.Root>
      )}
      <HStack alignItems="start" gap={4}>
        <SimpleGrid templateColumns="repeat(4, 1fr)" gap={5} width="100%">
          {checks.data
            ? renderGridItems(
              [...checks.data].sort((a, b) => {
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
    </GraphsLayout>
  );
}

export default withPermissionGuard("analytics:view")(EvaluationsContent);
