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
  Alert,
  AlertIcon,
  Spinner,
  Tag,
  useToast,
} from "../../langwatch/langwatch/node_modules/@chakra-ui/react";
import { useEffect, useState } from "react";
import { TrendingUp } from "../../langwatch/langwatch/node_modules/react-feather";
import SettingsLayout from "../../langwatch/langwatch/src/components/SettingsLayout";
import { useOrganizationTeamProject } from "../../langwatch/langwatch/src/hooks/useOrganizationTeamProject";
import { api } from "../../langwatch/langwatch/src/utils/api";
import { useRouter } from "next/router";
import type { Subscription } from "@prisma/client";
import { uppercaseFirstLetterLowerCaseRest } from "../../langwatch/langwatch/src/utils/stringCasing";

type PlanTypes = "FREE" | "PRO" | "GROWTH" | "ENTERPRISE";

export default function Subscription() {
  const { organization } = useOrganizationTeamProject();

  const activePlan = api.plan.getActivePlan.useQuery(
    { organizationId: organization?.id ?? "" },
    { enabled: !!organization }
  );

  const [selectedPlan, setSelectedPlan] = useState<PlanTypes>("FREE");

  const router = useRouter();
  const onPostSubscriptionSetup = router.query.success !== undefined;

  const [subscriptionFound, setSubscriptionFound] =
    useState<Subscription | null>(null);
  const subscription = (api as any).subscription.getLastSubscription.useQuery(
    {
      organizationId: organization?.id ?? "",
    },
    {
      enabled:
        !!organization &&
        (subscriptionFound === null || subscriptionFound.status === "PENDING"),
      refetchInterval: onPostSubscriptionSetup ? 1000 : false,
    }
  );

  const manageSubscription = (api as any).subscription.manage.useMutation();
  const toast = useToast();

  useEffect(() => {
    if (subscription.data) {
      setSubscriptionFound(subscription.data);
    }
  }, [subscription.data]);

  useEffect(() => {
    if (activePlan.data) {
      setSelectedPlan(activePlan.data.type as any);
    }
  }, [activePlan.data]);

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
              {onPostSubscriptionSetup &&
              subscriptionFound &&
              subscriptionFound.status !== "ACTIVE" ? (
                <Alert status="error">
                  <AlertIcon />
                  <Text>
                    Something went wrong with the payment or setup of your
                    subscription. Please try setting it up again!
                  </Text>
                </Alert>
              ) : onPostSubscriptionSetup ? (
                <Alert status="success">
                  <AlertIcon />
                  <HStack spacing={4}>
                    {subscription.isLoading ||
                    subscriptionFound === null ||
                    subscriptionFound.status === "PENDING" ? (
                      <>
                        <Text>
                          Subscription updated successfully! Checking payment
                          status...
                        </Text>
                        <Spinner />
                      </>
                    ) : (
                      <Text>
                        Subscription updated successfully! Your new plan is now
                        active!
                      </Text>
                    )}
                  </HStack>
                </Alert>
              ) : null}

              {activePlan.data && (
                <HStack spacing={2} paddingBottom={4}>
                  <Text>
                    <b>Current Plan:</b> {activePlan.data.name}
                  </Text>
                  {!activePlan.data.free && subscription.data && (
                    <Button
                      variant="link"
                      isLoading={manageSubscription.isLoading}
                      fontWeight="normal"
                      color="black"
                      onClick={() => {
                        void manageSubscription.mutate(
                          {
                            organizationId: organization?.id ?? "",
                            baseUrl: window.location.origin,
                          },
                          {
                            onSuccess: (result: any) => {
                              window.open(result.url, "_blank");
                            },
                            onError: () => {
                              toast({
                                title: "Error",
                                description:
                                  "An error occurred trying to manage your subscription. Please try again.",
                                status: "error",
                                duration: 5000,
                                isClosable: true,
                              });
                            },
                          }
                        );
                      }}
                    >
                      (manage)
                    </Button>
                  )}
                </HStack>
              )}

              <RadioGroup width="full" value={selectedPlan}>
                <VStack width="full" spacing={0} align="start">
                  <Plan
                    plan="FREE"
                    price={0}
                    description="For starting with LLM development"
                    features={[
                      "Single project and team member",
                      "1k messages limit",
                      "30-day messages retention",
                      "Trial evaluations and guardrails",
                    ]}
                    selectedPlan={selectedPlan}
                    setSelectedPlan={setSelectedPlan}
                  />
                  <Plan
                    plan="PRO"
                    price={99}
                    description="For small teams improving their LLM solutions"
                    features={[
                      "Up to 2 projects & 5 team members",
                      "10k messages limit",
                      "90-day messages retention",
                      "Usage-based price for evaluations and guardrails (including first €10 for free)",
                      "Slack support",
                    ]}
                    selectedPlan={selectedPlan}
                    setSelectedPlan={setSelectedPlan}
                  />
                  {/* <Plan
                    plan="GROWTH"
                    price={399}
                    description="For business with multiple teams working with LLMs"
                    features={[
                      "Up to 5 projects & 10 team members",
                      "100k messages limit",
                      "Custom retention",
                      "Usage-based price for evaluations and guardrails (including first €50 for free)",
                      "Premium onboarding & tech support",
                    ]}
                    selectedPlan={selectedPlan}
                    setSelectedPlan={setSelectedPlan}
                  /> */}
                  <Plan
                    plan="ENTERPRISE"
                    price={399}
                    description="Most scalable solution for enterprise needs"
                    features={[
                      "SOC2/ISO27001 compliance",
                      "Custom team members limit",
                      "Custom messages limit",
                      "Custom evaluations",
                      "Custom retention",
                      "Premium onboarding & tech support",
                    ]}
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
  plan,
  description,
  features,
  price,
  selectedPlan,
  setSelectedPlan,
}: {
  plan: PlanTypes;
  description: string;
  features: string[];
  price?: number | "custom";
  selectedPlan: PlanTypes;
  setSelectedPlan: (plan: PlanTypes) => void;
}) {
  const { organization } = useOrganizationTeamProject();
  const activePlan = api.plan.getActivePlan.useQuery(
    { organizationId: organization?.id ?? "" },
    { enabled: !!organization }
  );
  const createSubscription = (api as any).subscription.create.useMutation();
  const toast = useToast();

  const isCurrentPlan = activePlan.data?.type === plan;

  return (
    <Box
      width="full"
      border="1px solid"
      borderColor="gray.300"
      cursor="pointer"
      background={selectedPlan == plan ? "gray.50" : "white"}
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
        setSelectedPlan(plan);
      }}
    >
      <VStack align="start" width="full" padding={6}>
        <HStack align="start" width="full" spacing={3}>
          <Radio size="lg" value={plan} marginTop="2px" />
          <VStack spacing={4} align="start" paddingBottom={4}>
            <HStack spacing={4}>
              <Heading size="md" as="h2">
                {uppercaseFirstLetterLowerCaseRest(plan)}
              </Heading>
              {isCurrentPlan && <Tag colorScheme="green">Current Plan</Tag>}
            </HStack>
            <Text>{description}</Text>
            {features.map((feature) => (
              <Feature key={feature} label={feature} />
            ))}
          </VStack>
          <Spacer />
          {price === "custom" ? (
            <Text fontSize={22}>Custom</Text>
          ) : (
            <VStack spacing="0">
              {plan === "ENTERPRISE" && (
                <Text alignSelf="start" marginTop="3px" color="gray.500">
                  starting at
                </Text>
              )}
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
            </VStack>
          )}
        </HStack>
        {!isCurrentPlan && selectedPlan == plan && (
          <Box alignSelf="end" marginTop="-48px">
            {plan !== "ENTERPRISE" ? (
              <Button
                colorScheme="orange"
                isLoading={createSubscription.isLoading}
                onClick={() => {
                  void createSubscription.mutate(
                    {
                      organizationId: organization?.id ?? "",
                      baseUrl: window.location.origin,
                      plan: plan,
                    },
                    {
                      onSuccess: (result: any) => {
                        window.location.href = result.url;
                      },
                      onError: () => {
                        toast({
                          title: "Error",
                          description:
                            "An error occurred trying to subscribe. Please try again.",
                          status: "error",
                          duration: 5000,
                          isClosable: true,
                        });
                      },
                    }
                  );
                }}
              >
                {!activePlan.data || activePlan.data.free
                  ? "Subscribe"
                  : price !== "custom" &&
                    (price ?? 0) < activePlan.data.prices.EUR
                  ? "Downgrade"
                  : "Upgrade"}
              </Button>
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
      {/* @ts-ignore */}
      <TrendingUp size={16} />
      <Text>{label}</Text>
    </HStack>
  );
}
