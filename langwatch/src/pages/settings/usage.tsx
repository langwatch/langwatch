import {
  Alert,
  Card,
  HStack,
  Heading,
  Spacer,
  Table,
  Text,
  VStack,
} from "@chakra-ui/react";
import {
  PeriodSelector,
  usePeriodSelector,
} from "../../components/PeriodSelector";
import SettingsLayout from "../../components/SettingsLayout";
import { Link } from "../../components/ui/link";
import { useOrganizationTeamProject } from "../../hooks/useOrganizationTeamProject";
import { api } from "../../utils/api";
import { camelCaseToTitleCase } from "../../utils/stringCasing";

export default function Usage() {
  const { organization } = useOrganizationTeamProject();
  const { period, setPeriod } = usePeriodSelector(30);

  const activePlan = api.plan.getActivePlan.useQuery(
    {
      organizationId: organization?.id ?? "",
    },
    {
      enabled: !!organization,
    }
  );

  const aggregatedCosts = api.costs.getAggregatedCostsForOrganization.useQuery(
    {
      organizationId: organization?.id ?? "",
      startDate: period.startDate.getTime(),
      endDate: period.endDate.getTime(),
    },
    {}
  );

  return (
    <SettingsLayout>
      <VStack
        paddingX={4}
        paddingY={6}
        gap={6}
        width="full"
        maxWidth="920px"
        align="start"
      >
        <HStack width="full" marginTop={2}>
          <Heading size="lg" as="h1">
            Usage
          </Heading>
          <Spacer />
          <PeriodSelector period={period} setPeriod={setPeriod} />
        </HStack>
        <Card.Root width="full">
          <Card.Body width="full">
            <VStack
              width="full"
              gap={4}
              paddingY={4}
              paddingX={4}
              align="start"
            >
              {activePlan.data && (
                <>
                  <Heading size="md" as="h2">
                    Active Plan
                  </Heading>
                  <Text paddingBottom={4}>
                    You are on the {activePlan.data.name} plan
                    {activePlan.data.free && ", no payment is required"}
                  </Text>
                </>
              )}
              <Heading size="md" as="h2">
                Processing Costs
              </Heading>
              <Text paddingBottom={4}>
                Those are the costs for processing your messages and running
                checks on LangWatch, they are not the costs of your own LLMs,
                those can be visualized on the{" "}
                <Link href="/" textDecoration="underline">
                  project home page
                </Link>
                .
              </Text>
              {aggregatedCosts.isLoading ? (
                <Text>Loading... </Text>
              ) : aggregatedCosts.error ? (
                <Alert.Root status="error">
                  <Alert.Indicator />
                  <Alert.Content>
                    An error has occurred trying to load the costs
                  </Alert.Content>
                </Alert.Root>
              ) : aggregatedCosts.data.length == 0 ? (
                <Text>No costs</Text>
              ) : (
                aggregatedCosts.data.map((costGroup) => (
                  <VStack
                    key={costGroup.project.id}
                    align="start"
                    gap={4}
                    width="full"
                  >
                    <Heading size="sm" as="h3">
                      {costGroup.project.name}
                    </Heading>
                    <Table.Root
                      variant="line"
                      border="1px solid"
                      borderColor="gray.200"
                    >
                      <Table.Header>
                        <Table.Row>
                          <Table.ColumnHeader>Cost</Table.ColumnHeader>
                          <Table.ColumnHeader>Count</Table.ColumnHeader>
                          <Table.ColumnHeader>Amount</Table.ColumnHeader>
                        </Table.Row>
                      </Table.Header>
                      <Table.Body>
                        {costGroup.costs.map((cost) => (
                          <Table.Row key={`${cost.costType}-${cost.currency}`}>
                            <Table.Cell>
                              {camelCaseToTitleCase(
                                cost.costType.toLowerCase()
                              )}
                              {cost.costType === "TRACE_CHECK" &&
                                ` - ${cost.costName}`}
                            </Table.Cell>
                            <Table.Cell>{cost._count.id}</Table.Cell>
                            <Table.Cell>
                              {(cost._sum.amount ?? 0) < 0.01
                                ? `< ${cost.currency} 0.01`
                                : `${cost.currency} ${cost._sum.amount?.toFixed(
                                    2
                                  )}`}
                            </Table.Cell>
                          </Table.Row>
                        ))}
                      </Table.Body>
                    </Table.Root>
                  </VStack>
                ))
              )}
            </VStack>
          </Card.Body>
        </Card.Root>
      </VStack>
    </SettingsLayout>
  );
}
