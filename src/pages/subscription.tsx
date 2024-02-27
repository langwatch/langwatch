import {
  Box,
  Button,
  Card,
  CardBody,
  HStack,
  Heading,
  Link,
  Radio,
  RadioGroup,
  Spacer,
  Text,
  VStack,
} from "../../langwatch/langwatch/node_modules/@chakra-ui/react";
import { useState } from "react";
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

  const [selectedPlan, setSelectedPlan] = useState("Team");

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
              {activePlan.data && (
                <>
                  <Text paddingBottom={4}>
                    <b>Current Plan:</b> {activePlan.data.name}
                  </Text>
                </>
              )}

              <RadioGroup width="full" value={selectedPlan}>
                <VStack width="full" spacing={0} align="start">
                  <Plan
                    name="Team"
                    description="For teams starting with LLM development"
                    features={[
                      "Up to 5 team members",
                      "10k messages limit",
                      "90-day messages retention",
                      "Access to all guardrails",
                    ]}
                    betaOrDemo="beta"
                    selectedPlan={selectedPlan}
                    setSelectedPlan={setSelectedPlan}
                  />
                  <Plan
                    name="Business"
                    description="For business with multiple teams working with LLMs"
                    features={[
                      "Up to 20 team members",
                      "100k messages limit",
                      "Custom retention",
                      "Access to all guardrails",
                      "Priority Support",
                    ]}
                    betaOrDemo="demo"
                    selectedPlan={selectedPlan}
                    setSelectedPlan={setSelectedPlan}
                  />
                  <Plan
                    name="Enterprise"
                    description="Most scalable solution for enterprise needs"
                    features={[
                      "Unlimited team members",
                      "Unlimited messages",
                      "Custom retention",
                      "Access to all guardrails",
                      "Priority Support",
                    ]}
                    betaOrDemo="demo"
                    selectedPlan={selectedPlan}
                    setSelectedPlan={setSelectedPlan}
                  />
                </VStack>
              </RadioGroup>
            </VStack>
          </CardBody>
        </Card>
      </VStack>
    </SettingsLayout>
  );
}

function Plan({
  name,
  description,
  features,
  price,
  betaOrDemo,
  selectedPlan,
  setSelectedPlan,
}: {
  name: string;
  description: string;
  features: string[];
  price?: number;
  betaOrDemo: "beta" | "demo";
  selectedPlan: string;
  setSelectedPlan: (plan: string) => void;
}) {
  return (
    <Box
      width="full"
      border="1px solid"
      borderColor="gray.300"
      cursor="pointer"
      background={selectedPlan == name ? "gray.50" : "white"}
      borderTop="0px"
      _first={{
        borderRadius: "12px 12px 0 0",
        borderTop: "1px solid",
        borderColor: "gray.300",
      }}
      _last={{
        borderRadius: "0 0 12px 12px",
      }}
      onClick={() => {
        setSelectedPlan(name);
      }}
    >
      <VStack align="start" width="full" padding={6}>
        <HStack align="start" width="full" spacing={3}>
          <Radio size="lg" value={name} marginTop="2px" />
          <VStack spacing={4} align="start" paddingBottom={4}>
            <Heading size="md" as="h2">
              {name}
            </Heading>
            <Text>{description}</Text>
            {features.map((feature) => (
              <Feature key={feature} label={feature} />
            ))}
          </VStack>
          <Spacer />
          {price && (
            <HStack
              spacing="2px"
              fontSize={18}
              color="gray.600"
              marginTop="-3px"
            >
              <Text alignSelf="start" marginTop="3px">
                €
              </Text>
              <Text fontSize={26}>{price}</Text>
              <Text alignSelf="end" marginBottom="3px">
                /mo
              </Text>
            </HStack>
          )}
        </HStack>
        {selectedPlan == name && (
          <Box alignSelf="end" marginTop="-48px">
            {betaOrDemo == "beta" ? (
              <Link href="https://langwatch.ai/betalist" target="_blank">
                <Button colorScheme="orange">Sign-up to Beta</Button>
              </Link>
            ) : (
              <Link href="https://calendly.com/langwatch/30min" target="_blank">
                <Button colorScheme="orange">Schedule a Call</Button>
              </Link>
            )}
          </Box>
        )}
      </VStack>
    </Box>
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
