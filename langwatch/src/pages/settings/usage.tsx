import {
  Alert,
  AlertIcon,
  Card,
  CardBody,
  HStack,
  Heading,
  Spacer,
  Table,
  Tbody,
  Td,
  Text,
  Th,
  Thead,
  Tr,
  VStack,
} from "@chakra-ui/react";
import SettingsLayout from "../../components/SettingsLayout";
import { api } from "../../utils/api";
import { camelCaseToTitleCase } from "../../utils/stringCasing";
import {
  PeriodSelector,
  usePeriodSelector,
} from "../../components/PeriodSelector";
import { Link } from "@chakra-ui/next-js";
import { useOrganizationTeamProject } from "../../hooks/useOrganizationTeamProject";

export default function Usage() {
  const { organization } = useOrganizationTeamProject();
  const { period, setPeriod } = usePeriodSelector(30);

  const activePlan = api.subscription.getActivePlan.useQuery(
    {
      organizationId: organization?.id ?? "",
    },
    {
      enabled: !!organization,
    }
  );

  const aggregatedCosts = api.costs.getAggregatedCostsForOrganization.useQuery(
    {
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
        spacing={6}
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
        <Card width="full">
          <CardBody width="full">
            <VStack
              width="full"
              spacing={4}
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
                <Alert status="error">
                  <AlertIcon />
                  An error has occurred trying to load the costs
                </Alert>
              ) : aggregatedCosts.data.length == 0 ? (
                <Text>No costs</Text>
              ) : (
                aggregatedCosts.data.map((costGroup) => (
                  <VStack
                    key={costGroup.project.id}
                    align="start"
                    spacing={4}
                    width="full"
                  >
                    <Heading size="sm" as="h3">
                      {costGroup.project.name}
                    </Heading>
                    <Table border="1px solid" borderColor="gray.200">
                      <Thead>
                        <Tr>
                          <Th>Cost</Th>
                          <Th>Count</Th>
                          <Th>Amount</Th>
                        </Tr>
                      </Thead>
                      <Tbody>
                        {costGroup.costs.map((cost) => (
                          <Tr key={`${cost.costType}-${cost.currency}`}>
                            <Td>
                              {camelCaseToTitleCase(
                                cost.costType.toLowerCase()
                              )}
                              {cost.costType === "TRACE_CHECK" &&
                                ` - ${cost.costName}`}
                            </Td>
                            <Td>{cost._count.id}</Td>
                            <Td>
                              {(cost._sum.amount ?? 0) < 0.01
                                ? `< ${cost.currency} 0.01`
                                : `${cost.currency} ${cost._sum.amount?.toFixed(
                                    2
                                  )}`}
                            </Td>
                          </Tr>
                        ))}
                      </Tbody>
                    </Table>
                  </VStack>
                ))
              )}
            </VStack>
          </CardBody>
        </Card>
      </VStack>
    </SettingsLayout>
  );
}
