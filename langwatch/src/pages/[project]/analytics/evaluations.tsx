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

const renderGridItems = (checks: any) => {
  return checks.map((check: any) => {
    let checksAverage = {};
    let checksSummary = {};
    const traceCheck = getEvaluatorDefinitions(check.checkType);

    const isCategoryEvaluator = check.checkType === "langevals/llm_category";

    if (traceCheck?.isGuardrail) {
      // Boolean/guardrail evaluators: show pass/fail distribution
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
      checksSummary = {
        graphId: "custom",
        graphType: "donnut",
        series: [
          {
            name: "Traces count",
            colorSet: "colors",
            metric: "metadata.trace_id",
            aggregation: "cardinality",
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
              <CustomGraph input={checksSummary as CustomGraphInput} />
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
              <CustomGraph input={checksAverage as CustomGraphInput} />
            </Card.Body>
          </Card.Root>
        </GridItem>
      </>
    );
  });
};

function EvaluationsContent() {
  const { project } = useOrganizationTeamProject();
  const checks = api.monitors.getAllForProject.useQuery(
    {
      projectId: project?.id ?? "",
    },
    { enabled: !!project },
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
