import {
  Alert,
  AlertDescription,
  AlertIcon,
  AlertTitle,
  Box,
  Card,
  CardBody,
  CardHeader,
  GridItem,
  HStack,
  Heading,
  Link,
  SimpleGrid,
  Text,
  VStack
} from "@chakra-ui/react";
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
import { getEvaluatorDefinitions } from "../../../evaluations/getEvaluator";

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
        <GridItem colSpan={1} display={"inline-grid"}>
          <Card>
            <CardHeader>
              <HStack>
                <BarChart2 color="orange" />
                <Heading size="sm">{traceCheck?.name}</Heading>
              </HStack>
              {!check.enabled && (
                <Text textColor={"gray"} fontSize={"sm"}>
                  (disabled)
                </Text>
              )}
            </CardHeader>
            <CardBody>
              <CustomGraph input={checksSummary as CustomGraphInput} />
            </CardBody>
          </Card>
        </GridItem>
        <GridItem colSpan={3} display={"inline-grid"}>
          <Card>
            <CardHeader>
              <HStack>
                <BarChart2 color="orange" />
                <Heading size="sm">{traceCheck?.name}</Heading>

                <Text fontWeight={300}>- {check.name}</Text>
              </HStack>
              {!check.enabled && (
                <Text textColor={"gray"} fontSize={"sm"}>
                  (disabled)
                </Text>
              )}
            </CardHeader>
            <CardBody>
              <CustomGraph input={checksAverage as CustomGraphInput} />
            </CardBody>
          </Card>
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
        <Alert status="warning" variant="left-accent" marginBottom={6}>
          <AlertIcon alignSelf="start" />
          <VStack align="start">
            <AlertTitle>No Evaluations yet</AlertTitle>
            <AlertDescription>
              <Text as="span">
                {
                  "The evaluation results will be displayed here. Setup evaluations for your project to see the results. Click "
                }
              </Text>
              <Link
                textDecoration="underline"
                href={`/${project?.slug}/evaluations`}
              >
                here
              </Link>
              <Text as="span"> to get started.</Text>
            </AlertDescription>
          </VStack>
        </Alert>
      )}
      <HStack alignItems={"start"}>
        <SimpleGrid
          templateColumns="repeat(4, 1fr)"
          gap={5}
          width={"100%"}
        >
          {checks.data ? creatChecks(checks.data) : null}
        </SimpleGrid>
        <Box padding={3}>
          <FilterSidebar hideTopics={true} />
        </Box>
      </HStack>
    </GraphsLayout>
  );
}
