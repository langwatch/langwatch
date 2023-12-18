import {
  Card,
  CardBody,
  HStack,
  Heading,
  Spacer,
  Text,
  VStack,
} from "../../langwatch/langwatch/node_modules/@chakra-ui/react";
import { TrendingUp } from "../../langwatch/langwatch/node_modules/react-feather";
import SettingsLayout from "../../langwatch/langwatch/src/components/SettingsLayout";
import { useOrganizationTeamProject } from "../../langwatch/langwatch/src/hooks/useOrganizationTeamProject";
import { api } from "../../langwatch/langwatch/src/utils/api";

export default function Subscription() {
  const { organization } = useOrganizationTeamProject();

  const activePlan = api.subscription.getActivePlan.useQuery(
    {
      organizationId: organization?.id ?? "",
    },
    {
      enabled: !!organization,
    }
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
            Change Subscription
          </Heading>
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
              {/* {activePlan.data && (
                <>
                  <Text paddingBottom={4}>
                    <b>Current Plan:</b> {activePlan.data.name}
                  </Text>
                </>
              )} */}

              <VStack
                width="full"
                spacing={4}
                align="start"
                border="1px solid"
                borderColor="gray.300"
                borderRadius={12}
              >
                <HStack align="start" width="full" padding={6}>
                  <VStack spacing={4} align="start">
                    <Heading size="md" as="h2">
                      Team
                    </Heading>
                    <Text>For teams starting with LLM development</Text>
                    <Feature label="Up to 5 team members" />
                    <Feature label="10k messages limit" />
                    <Feature label="90-day messages retention" />
                    <Feature label="Access to all guardrails" />
                  </VStack>
                  <Spacer />
                  <HStack
                    spacing="2px"
                    fontSize={18}
                    color="gray.600"
                    marginTop="-3px"
                  >
                    <Text alignSelf="start" marginTop="3px">
                      €
                    </Text>
                    <Text fontSize={26}>99</Text>
                    <Text alignSelf="end" marginBottom="3px">
                      /mo
                    </Text>
                  </HStack>
                </HStack>
              </VStack>
            </VStack>
          </CardBody>
        </Card>
      </VStack>
    </SettingsLayout>
  );
}

function Feature({ label }: { label: string }) {
  return (
    <HStack spacing={2}>
      <TrendingUp size={16} />
      <Text>{label}</Text>
    </HStack>
  );
}
