"use client";
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
  Switch,
  Grid,
  SimpleGrid,
  GridItem,
} from "../../langwatch/langwatch/node_modules/@chakra-ui/react";
// @ts-ignore
import {
  useEffect,
  useState,
} from "../../langwatch/langwatch/node_modules/react";
import {
  TrendingUp,
  Check,
} from "../../langwatch/langwatch/node_modules/react-feather";
import SettingsLayout from "../../langwatch/langwatch/src/components/SettingsLayout";
import { useOrganizationTeamProject } from "../../langwatch/langwatch/src/hooks/useOrganizationTeamProject";
import { api } from "../../langwatch/langwatch/src/utils/api";
import { useRouter } from "next/router";
import type { Subscription } from "@prisma/client";
import { uppercaseFirstLetterLowerCaseRest } from "../../langwatch/langwatch/src/utils/stringCasing";

type PlanTypes =
  | "FREE"
  | "PRO"
  | "GROWTH"
  | "ENTERPRISE"
  | "LAUNCH"
  | "ACCELERATE"
  | "SCALE";

export default function Subscription() {
  const { organization } = useOrganizationTeamProject();
  const [billAnnually, setBillAnnually] = useState(false);

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
    <SettingsLayout isSubscription>
      <VStack
        paddingX={4}
        paddingY={6}
        width="full"
        maxWidth="920px"
        align="start"
      >
        <HStack width="full" marginTop={2} paddingX={4}>
          <Heading size="lg" as="h1">
            Choose Your Subscription
          </Heading>
          <HStack spacing={2} marginLeft={4}>
            <Text>Bill Monthly</Text>
            <Switch
              colorScheme="green"
              isChecked={billAnnually}
              onChange={() => setBillAnnually(!billAnnually)}
            />
            <Text>Bill Annually</Text>
          </HStack>
        </HStack>

        <VStack spacing={4} paddingY={4} paddingX={4} align="start">
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
            <SimpleGrid templateColumns="repeat(5, 1fr)" gap={3}>
              <Plan
                plan="FREE"
                price={0}
                description="For starting with LLM development"
                features={[
                  "1k Traces",
                  "30-day retention",
                  "1 Project",
                  "1 Team Member",
                ]}
                selectedPlan={selectedPlan}
                setSelectedPlan={setSelectedPlan}
              />
              <Plan
                plan="PRO"
                price={99}
                isAnnual={billAnnually}
                annualPrice={1089}
                description="For small teams improving their LLM solutions"
                features={[
                  "10,000 Traces",
                  "2 projects",
                  "5 team members",
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
              {/* <Plan
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
                  /> */}
              <Plan
                plan="LAUNCH"
                isAnnual={billAnnually}
                price={149}
                annualPrice={1644}
                description="For small teams improving their LLM solutions"
                features={[
                  "Optimization Studio (DSPy optimizers)",
                  "Up to 10 workflows",
                  "10,000 Traces",
                  "30-day retention",
                  "1 Project",
                  "1 Team Member",
                ]}
                additionalCosts={[
                  "Additional Traces - €50/100,000",
                  "Additional Users - €19/user",
                  "Usage-based price for evaluations and guardrails (including first €10 for free)",
                  ``,
                ]}
                selectedPlan={selectedPlan}
                setSelectedPlan={setSelectedPlan}
              />
              <Plan
                plan="ACCELERATE"
                isAnnual={billAnnually}
                price={499}
                annualPrice={5269}
                description="For business with multiple teams working with LLMs"
                features={[
                  "Optimization Studio (DSPy optimizers)",
                  "Up to 50 workflows",
                  "100,000 Traces",
                  "60-day retention",
                  "10 Projects",
                  "10 Team Members",
                ]}
                additionalCosts={[
                  "Additional Traces - €45/100,000",
                  "Additional Users - €10/user",
                  `Usage-based price for evaluations and guardrails (including first €10 for free)`,
                ]}
                selectedPlan={selectedPlan}
                setSelectedPlan={setSelectedPlan}
              />
              <Plan
                plan="ENTERPRISE"
                isAnnual={billAnnually}
                price="custom"
                annualPrice={9169}
                description="Most scalable solution for enterprise needs"
                features={[
                  "Optimization Studio (DSPy optimizers)",
                  "Unlimited workflows",
                  "Custom Traces",
                  "Custom retention",
                  "Custom Projects",
                  "Custom Team Members",
                  "Self-Hosted available",
                  "RBAC control",
                  "SOC2 Reporting",
                ]}
                additionalCosts={["Custom"]}
                selectedPlan={selectedPlan}
                setSelectedPlan={setSelectedPlan}
              />
            </SimpleGrid>
          </RadioGroup>
        </VStack>
      </VStack>
    </SettingsLayout>
  );
}

function Plan({
  plan,
  description,
  features,
  price,
  additionalCosts,
  annualPrice,
  isAnnual,
  selectedPlan,
  setSelectedPlan,
}: {
  plan: PlanTypes;
  description: string;
  features: string[];
  price?: number | "custom";
  additionalCosts?: string[];
  annualPrice?: number;
  isAnnual?: boolean;
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

  console.log(plan);

  return (
    <GridItem
      border="1px solid"
      borderColor="gray.300"
      cursor="pointer"
      background={selectedPlan == plan ? "gray.50" : "white"}
      borderTop="0px"
      borderRadius="12px 12px 0 0"
      minWidth="300px"
      height="100%"
      onClick={() => {
        setSelectedPlan(plan);
      }}
    >
      <VStack
        align="start"
        width="full"
        padding={3}
        spacing={3}
        height="100%"
        justifyContent="space-between"
      >
        <VStack width="full" align="start">
          <HStack align="start" width="full" spacing={3}>
            <Radio size="lg" value={plan} marginTop="2px" />
            <VStack spacing={4} align="start" paddingBottom={4}>
              <HStack spacing={4}>
                <Heading size="md" as="h2">
                  {uppercaseFirstLetterLowerCaseRest(plan)}
                </Heading>
              </HStack>
            </VStack>

            <Spacer />
            {price === "custom" ? null : (
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
                  <Text fontSize={26}>{isAnnual ? annualPrice : price}</Text>
                  <Text alignSelf="end" marginBottom="3px">
                    {isAnnual ? "/yr" : "/mo"}
                  </Text>
                </HStack>
              </VStack>
            )}
          </HStack>

          {isCurrentPlan && <Tag colorScheme="green">Current Plan</Tag>}

          <Text>{description}</Text>
          {features.map((feature) => (
            <Feature key={feature} label={feature} />
          ))}
          {additionalCosts && (
            <>
              <Text fontWeight="bold">Add-On Costs:</Text>
              {additionalCosts?.map((cost) => (
                <Text key={cost}>{cost}</Text>
              ))}
            </>
          )}
        </VStack>
        {/* {!isCurrentPlan && selectedPlan == plan && ( */}
        {!isCurrentPlan && (
          <HStack width="full">
            {plan !== "ENTERPRISE" ? (
              <Button
                colorScheme="green"
                width="full"
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
                      onError: (e) => {
                        console.log(e);
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
              <Link
                href="https://calendly.com/langwatch/30min"
                target="_blank"
                width="full"
              >
                <Button colorScheme="green" width="full">
                  Schedule a Call
                </Button>
              </Link>
            )}
          </HStack>
        )}
      </VStack>
    </GridItem>
  );
}

function Feature({ label }: { label: string }) {
  return (
    <HStack spacing={2}>
      {/* @ts-ignore */}
      <Check size={16} color="green" strokeWidth={3} />
      <Text noWrap>{label}</Text>
    </HStack>
  );
}
