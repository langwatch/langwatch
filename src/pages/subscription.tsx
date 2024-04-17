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
      <VStack paddingX={4} paddingY={6} spacing={6} width="full" align="start">
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
                <HStack width="full" spacing={4} align="start">
                  <Plan
                    name="Team"
                    price="€99/mo"
                    description="For teams starting with LLM development"
                    features={[
                      "2 projects",
                      "10k messages",
                      "Evaluations (incl €10 in credit)",
                      "2 team members",
                      "30-day messages retention",
                      "Premium onboarding & tech support",
                    ]}
                    betaOrDemo="beta"
                    selectedPlan={selectedPlan}
                    setSelectedPlan={setSelectedPlan}
                  />
                  <Plan
                    name="Business"
                    price="€399/mo"
                    description="For business with multiple teams working with LLMs"
                    features={[
                      "5 projects",
                      "100k messages",
                      "Evaluations (incl €50 in credits)",
                      "10 team members",
                      "90-day messages retention",
                      "Premium onboarding & tech support",
                    ]}
                    betaOrDemo="demo"
                    selectedPlan={selectedPlan}
                    setSelectedPlan={setSelectedPlan}
                  />
                  <Plan
                    name="Enterprise"
                    price="Custom"
                    description="Most scalable solution for enterprise needs"
                    features={[
                      "Custom projects",
                      "Unlimited messages",
                      "Custom evaluations",
                      "Custom members",
                      "Custom messages retention",
                      "Premium onboarding & tech support",
                      "SOC2 certifications",
                    ]}
                    betaOrDemo="demo"
                    selectedPlan={selectedPlan}
                    setSelectedPlan={setSelectedPlan}
                  />
                </HStack>
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
  price?: string;
  betaOrDemo: "beta" | "demo";
  selectedPlan: string;
  setSelectedPlan: (plan: string) => void;
}) {
  return (
    <Card
      width="full"
      height="530"
      border="1px solid"
      borderColor="gray.300"
      cursor="pointer"
      background={selectedPlan == name ? "gray.50" : "white"}
      boxShadow="none"
      borderRadius="12px"
      onClick={() => {
        setSelectedPlan(name);
      }}
    >
      <CardBody>
        <VStack align="start" width="full" padding={6}>
          <HStack align="start" width="full" spacing={3}>
            <Radio size="lg" value={name} marginTop="2px" />
            <VStack spacing={4} align="start" paddingBottom={4}>
              <VStack spacing={1} align="start">
                <Heading size="md" as="h2" color="orange">
                  {name}
                </Heading>
                <Heading size="md" as="h3">
                  {price}
                </Heading>
              </VStack>
              <Text fontWeight="bold">Product & Services</Text>
              {features.map((feature) => (
                <Feature key={feature} label={feature} />
              ))}
              {selectedPlan == name && (
                <Box
                  position="absolute"
                  bottom="20px"
                  left="0"
                  right="0"
                  padding="5px"
                  margin="0 auto"
                  width="fit-content"
                >
                  {betaOrDemo == "beta" ? (
                    <Link href="https://langwatch.ai/betalist" target="_blank">
                      <Button colorScheme="orange">Sign-up to Beta</Button>
                    </Link>
                  ) : (
                    <Link
                      href="https://calendly.com/langwatch/30min"
                      target="_blank"
                    >
                      <Button colorScheme="orange">Schedule a Call</Button>
                    </Link>
                  )}
                </Box>
              )}
            </VStack>
            <Spacer />
          </HStack>
        </VStack>
      </CardBody>
    </Card>
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
