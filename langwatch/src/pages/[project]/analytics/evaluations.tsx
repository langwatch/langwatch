import {
  Box,
  Card,
  GridItem,
  HStack,
  Heading,
  SimpleGrid,
  Text,
  Alert,
} from "@chakra-ui/react";
import { Link } from "~/components/ui/link";
import { BarChart2 } from "react-feather";
import GraphsLayout from "~/components/GraphsLayout";
import {
  CustomGraph,
  type CustomGraphInput,
} from "~/components/analytics/CustomGraph";
import { FilterSidebar } from "~/components/filters/FilterSidebar";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { api } from "~/utils/api";
import { AnalyticsHeader } from "../../../components/analytics/AnalyticsHeader";
import { getEvaluatorDefinitions } from "../../../server/evaluations/getEvaluator";

const creatChecks = (checks: any) => {
  return checks.map((check: any) => {
    let checksAverage = {};
    let checksSummary = {};
    const traceCheck = getEvaluatorDefinitions(check.checkType);

    if (traceCheck?.isGuardrail) {
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
        includePrevious: false,
        timeScale: 1,
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
        includePrevious: false,
        timeScale: 1,
        height: 300,
      };
    } else {
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
        timeScale: 1,
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
        timeScale: 1,
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
                <Heading size="sm">{traceCheck?.name}</Heading>
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
                <Heading size="sm">{traceCheck?.name}</Heading>
                <Text fontWeight={300}>- {check.name}</Text>
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

export default function Evaluations() {
  const { project } = useOrganizationTeamProject();
  const checks = api.checks.getAllForProject.useQuery(
    {
      projectId: project?.id ?? "",
    },
    { enabled: !!project }
  );

  return (
    <GraphsLayout>
      <AnalyticsHeader title="Evaluations" />
      {checks.data && checks.data?.length === 0 && (
        <Alert.Root
          colorPalette="warning"
          borderStartWidth="4px"
          borderStartColor="colorPalette.solid"
          marginBottom={6}
        >
          <Alert.Indicator />
          <Alert.Content>
            <Alert.Title>No Evaluations yet</Alert.Title>
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
          {checks.data ? creatChecks(checks.data) : null}
        </SimpleGrid>
        <Box padding={3}>
          <FilterSidebar hideTopics={true} />
        </Box>
      </HStack>
    </GraphsLayout>
  );
}
