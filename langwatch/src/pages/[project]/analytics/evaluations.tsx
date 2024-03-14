import {
  Card,
  CardBody,
  CardHeader,
  Container,
  GridItem,
  HStack,
  Heading,
  SimpleGrid,
  Spacer,
  Text,
} from "@chakra-ui/react";
import GraphsLayout from "~/components/GraphsLayout";
import { PeriodSelector, usePeriodSelector } from "~/components/PeriodSelector";
import {
  CustomGraph,
  type CustomGraphInput,
} from "~/components/analytics/CustomGraph";
import {
  FilterToggle,
  useFilterToggle,
} from "~/components/filters/FilterToggle";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { getTraceCheckDefinitions } from "~/trace_checks/registry";

import { api } from "~/utils/api";

const creatChecks = (checks: any) => {
  return checks.map((check: any) => {
    let checksAverage = {};
    let checksSummary = {};
    const traceCheck = getTraceCheckDefinitions(check.checkType);
    if (!check.enabled) return null;

    if (traceCheck?.valueDisplayType === "boolean") {
      checksSummary = {
        graphId: "custom",
        graphType: "donnut",
        series: [
          {
            name: "Checks count",
            colorSet: "positiveNegativeNeutral",
            metric: "evaluations.checks",
            aggregation: "cardinality",
            key: check.id,
          },
        ],
        groupBy: "evaluations.check_state",
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
            metric: "evaluations.checks",
            aggregation: "cardinality",
            pipeline: {
              field: "trace_id",
              aggregation: "sum",
            },
            key: check.id,
          },
        ],
        groupBy: "evaluations.check_state",
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
              <Heading size="sm">{traceCheck?.name}</Heading>
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
                <Heading size="sm">{traceCheck?.name}</Heading>

                <Text fontWeight={300}>- {check.name}</Text>
              </HStack>
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

  console.log(checks.data);

  const {
    period: { startDate, endDate },
    setPeriod,
  } = usePeriodSelector();
  const { showFilters } = useFilterToggle();

  return (
    <GraphsLayout>
      <Container maxWidth={showFilters ? "1300" : "1200"} padding={6}>
        <HStack width="full" marginBottom={3}>
          <Spacer />
          <FilterToggle />
          <PeriodSelector
            period={{ startDate, endDate }}
            setPeriod={setPeriod}
          />
        </HStack>
        <hr />
        <HStack paddingY={2}>
          <SimpleGrid
            templateColumns="repeat(4, 1fr)"
            gap={5}
            marginTop={4}
            width={"100%"}
          >
            {checks.data ? creatChecks(checks.data) : null}
          </SimpleGrid>
        </HStack>
      </Container>
    </GraphsLayout>
  );
}
