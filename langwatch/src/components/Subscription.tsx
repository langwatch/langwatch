"use client";
import {
  Alert,
  Box,
  Button,
  Card,
  HStack,
  Heading,
  Link,
  SimpleGrid,
  Slider,
  Spinner,
  Tag,
  Text,
  VStack,
} from "@langwatch-oss/node_modules/@chakra-ui/react";
// @ts-ignore
//import { useEffect, useState } from "@langwatch-oss/node_modules/react";
import { useEffect, useState, type ReactNode } from "react";

import { trackEvent } from "@langwatch-oss/src/utils/tracking";

import { Check, Info, X } from "@langwatch-oss/node_modules/react-feather";
import SettingsLayout from "@langwatch-oss/src/components/SettingsLayout";
import { Switch } from "@langwatch-oss/src/components/ui/switch";
import { toaster } from "@langwatch-oss/src/components/ui/toaster";
import { Tooltip } from "@langwatch-oss/src/components/ui/tooltip";
import { useOrganizationTeamProject } from "@langwatch-oss/src/hooks/useOrganizationTeamProject";
import { api } from "@langwatch-oss/src/utils/api";
import type { Subscription } from "@prisma/client";
import { useRouter } from "next/router";

type PlanTypes =
  | "FREE"
  | "PRO"
  | "GROWTH"
  | "ENTERPRISE"
  | "LAUNCH"
  | "ACCELERATE"
  | "LAUNCH_ANNUAL"
  | "ACCELERATE_ANNUAL"
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
          <HStack gap={2} marginLeft={4}>
            <Text>Bill Monthly</Text>
            <Switch
              colorPalette="green"
              checked={billAnnually}
              onChange={() => setBillAnnually(!billAnnually)}
            />
            <Text>Bill Annually</Text>
          </HStack>
        </HStack>

        <VStack gap={4} paddingY={4} paddingX={4} align="start">
          {onPostSubscriptionSetup &&
          subscriptionFound &&
          subscriptionFound.status !== "ACTIVE" ? (
            <Alert.Root status="error">
              <Alert.Indicator />
              <Alert.Content>
                Something went wrong with the payment or setup of your
                subscription. Please try setting it up again!
              </Alert.Content>
            </Alert.Root>
          ) : onPostSubscriptionSetup ? (
            <Alert.Root status="success">
              <Alert.Indicator />
              <Alert.Content>
                <HStack gap={4}>
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
              </Alert.Content>
            </Alert.Root>
          ) : null}

          <SimpleGrid
            templateColumns={{
              base: "repeat(1, 1fr)",
              md: "repeat(2, 1fr)",
              lg: "repeat(5, 1fr)",
            }}
            gap={3}
          >
            <Plan
              plan="FREE"
              name="Free"
              price={0}
              description="For starting with LLM monitoring and optimization"
              features={[
                "1 Workflow",
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
              name="Pro"
              price={99}
              hidden={true}
              description="For small teams improving their LLM solutions"
              features={[
                "10,000 Traces",
                "2 projects",
                "5 team members",
                "90-day messages retention",
                "Usage-based price for evaluations and guardrails",
                "Slack support",
              ]}
              selectedPlan={selectedPlan}
              setSelectedPlan={setSelectedPlan}
            />
            <Plan
              plan="LAUNCH"
              name="Launch"
              price={59}
              hidden={billAnnually}
              description={
                <>
                  For small teams improving their LLM solutions.{" "}
                  <b>Startups only</b>{" "}
                  <Box display="inline-block" marginBottom="-3px">
                    <Tooltip content="Limited to companies with 1-10 employees or for personal usage.">
                      <Info size={16} />
                    </Tooltip>
                  </Box>
                </>
              }
              features={[
                "Up to 10 workflows",
                "10,000 Traces",
                "6 months retention",
                "1 Project",
                "2 Team Members",
              ]}
              additionalCosts={[
                "Additional Traces - €5pm/10,000",
                "Additional Users - €19pm/user",
                "Usage-based price for evaluations and guardrails",
                ``,
              ]}
              additionalUserCost={19}
              additionalTracesCost={5}
              minTraces={10000}
              minMembers={2}
              maxTraces={100000}
              maxMembers={10}
              selectedPlan={selectedPlan}
              setSelectedPlan={setSelectedPlan}
              subscription={subscription.data}
              traceStep={10000}
            />
            <Plan
              plan="LAUNCH_ANNUAL"
              name="Launch"
              // saving={"8% saving"}
              isAnnual={billAnnually}
              hidden={!billAnnually}
              price={651}
              description={
                <>
                  For small teams improving their LLM solutions.{" "}
                  <b>Startups only</b>{" "}
                  <Box display="inline-block" marginBottom="-3px">
                    <Tooltip content="Limited to companies with 1-10 employees or for personal usage.">
                      <Info size={16} />
                    </Tooltip>
                  </Box>
                </>
              }
              features={[
                "Up to 10 workflows",
                "10,000 Traces",
                "6 months retention",
                "1 Project",
                "2 Team Members",
              ]}
              additionalCosts={[
                "Additional Traces - €5pm/10,000",
                "Additional Users - €19pm/user",
                "Usage-based price for evaluations and guardrails",
                ``,
              ]}
              additionalUserCost={19}
              additionalTracesCost={5}
              minTraces={10000}
              minMembers={2}
              maxTraces={100000}
              maxMembers={10}
              selectedPlan={selectedPlan}
              setSelectedPlan={setSelectedPlan}
              subscription={subscription.data}
              traceStep={10000}
            />
            <Plan
              plan="ACCELERATE"
              name="Accelerate"
              recommended={true}
              hidden={billAnnually}
              price={499}
              description="For business with multiple teams working with LLMs"
              features={[
                "Up to 50 workflows",
                "100,000 Traces",
                "1 year retention",
                "10 Projects",
                "10 Team Members",
              ]}
              additionalCosts={[
                "Additional Traces - €29pm/100,000",
                "Additional Users - €10pm/user",
                `Usage-based price for evaluations and guardrails`,
              ]}
              selectedPlan={selectedPlan}
              setSelectedPlan={setSelectedPlan}
              additionalUserCost={10}
              additionalTracesCost={29}
              minTraces={100000}
              minMembers={10}
              maxTraces={1000000}
              maxMembers={50}
              traceStep={100000}
              subscription={subscription.data}
            />
            <Plan
              plan="ACCELERATE_ANNUAL"
              isAnnual={billAnnually}
              hidden={!billAnnually}
              recommended={true}
              saving={"12% saving"}
              price={5269}
              name="Accelerate"
              description="For business with multiple teams working with LLMs"
              features={[
                "Up to 50 workflows",
                "100,000 Traces",
                "1 year retention",
                "10 Projects",
                "10 Team Members",
              ]}
              additionalCosts={[
                "Additional Traces - €29pm/100,000",
                "Additional Users - €10pm/user",
                `Usage-based price for evaluations and guardrails`,
              ]}
              selectedPlan={selectedPlan}
              setSelectedPlan={setSelectedPlan}
              additionalUserCost={10}
              additionalTracesCost={29}
              minTraces={100000}
              minMembers={10}
              maxTraces={1000000}
              maxMembers={50}
              traceStep={100000}
              subscription={subscription.data}
            />
            <Plan
              plan="ENTERPRISE"
              name="Enterprise"
              isAnnual={billAnnually}
              price="custom"
              description="Most scalable solution for enterprise needs"
              features={[
                "Unlimited workflows",
                "Custom Traces",
                "Custom retention",
                "Custom Projects",
                "Custom Team Members",
                "Self-Hosting available",
                "RBAC control",
                "SOC2 Reporting",
              ]}
              additionalCosts={["Custom"]}
              selectedPlan={selectedPlan}
              setSelectedPlan={setSelectedPlan}
            />
          </SimpleGrid>
        </VStack>
      </VStack>
    </SettingsLayout>
  );
}

function Plan({
  plan,
  features,
  price,
  lifetimeDealOriginalPrice,
  additionalCosts,
  isAnnual,
  selectedPlan,
  setSelectedPlan,
  hidden,
  name,
  recommended,
  saving,
  additionalUserCost,
  additionalTracesCost,
  minTraces,
  maxTraces,
  minMembers,
  maxMembers,
  traceStep,
}: {
  plan: PlanTypes;
  description: string | ReactNode;
  features: Array<string | ReactNode>;
  price?: number | "custom";
  lifetimeDealOriginalPrice?: number;
  additionalCosts?: string[];
  isAnnual?: boolean;
  selectedPlan: PlanTypes;
  setSelectedPlan: (plan: PlanTypes) => void;
  hidden?: boolean;
  name: string;
  recommended?: boolean;
  saving?: string;
  additionalUserCost?: number;
  additionalTracesCost?: number;
  minTraces?: number;
  maxTraces?: number;
  minMembers?: number;
  maxMembers?: number;
  traceStep?: number;
}) {
  const { organization } = useOrganizationTeamProject();
  const activePlan = api.plan.getActivePlan.useQuery(
    { organizationId: organization?.id ?? "" },
    { enabled: !!organization }
  );
  const createSubscription = (api as any).subscription.create.useMutation();

  const sendSlackNotification = (
    api as any
  ).subscription.sendSlackNotification.useMutation();

  const isCurrentPlan = activePlan.data?.type === plan;

  const [selectedMaxMembersPerMonth, setSelectedMaxMembersPerMonth] = useState(
    activePlan.data?.maxMembers ?? minMembers ?? 0
  );
  const [selectedMaxMessagesPerMonth, setSelectedMaxMessagesPerMonth] =
    useState(activePlan.data?.maxMessagesPerMonth ?? minTraces ?? 0);

  const [totalCost, setTotalCost] = useState(
    typeof price === "number" ? price : 0
  );

  useEffect(() => {
    if (activePlan.data) {
      if (isCurrentPlan) {
        setSelectedMaxMembersPerMonth(
          activePlan.data.maxMembers ?? minMembers ?? 0
        );
        setSelectedMaxMessagesPerMonth(
          activePlan.data.maxMessagesPerMonth ?? minTraces ?? 0
        );
      }
    }
  }, [activePlan.data, isCurrentPlan, minMembers, minTraces]);

  useEffect(() => {
    const userCost =
      (selectedMaxMembersPerMonth - (minMembers ?? 0)) *
      (additionalUserCost ?? 0);
    const tracesCost =
      ((selectedMaxMessagesPerMonth - (minTraces ?? 0)) *
        (additionalTracesCost ?? 0)) /
      (traceStep ?? 10000);

    if (typeof price === "number") {
      setTotalCost(price + userCost + tracesCost);
    }
  }, [
    selectedMaxMembersPerMonth,
    selectedMaxMessagesPerMonth,
    additionalUserCost,
    additionalTracesCost,
    price,
  ]);

  // Slider change handlers
  const handleMaxMembersChange = (value: number) => {
    setSelectedMaxMembersPerMonth(value);
  };

  const handleMaxMessagesChange = (value: number) => {
    setSelectedMaxMessagesPerMonth(value);
  };

  const upgradeMembers =
    (selectedMaxMembersPerMonth ?? 0) > (activePlan.data?.maxMembers ?? 0) ||
    (selectedMaxMembersPerMonth ?? 0) < (activePlan.data?.maxMembers ?? 0);
  const upgradeTraces =
    (selectedMaxMessagesPerMonth ?? 0) >
      (activePlan.data?.maxMessagesPerMonth ?? 0) ||
    (selectedMaxMessagesPerMonth ?? 0) <
      (activePlan.data?.maxMessagesPerMonth ?? 0);

  const addTeamMemberOrTraces = (
    api as any
  ).subscription.addTeamMemberOrTraces.useMutation();
  const manageSubscription = (api as any).subscription.manage.useMutation();

  const canUpgrade = () => {
    return upgradeMembers || upgradeTraces;
  };

  const handleUpgradeOptions = () => {
    const membersToUpgrade = selectedMaxMembersPerMonth ?? 0;
    const tracesToUpgrade = selectedMaxMessagesPerMonth ?? 0;

    void addTeamMemberOrTraces.mutate(
      {
        organizationId: organization?.id ?? "",
        plan: activePlan.data?.type ?? "FREE",
        upgradeMembers: upgradeMembers,
        upgradeTraces: upgradeTraces,
        totalMembers: membersToUpgrade,
        totalTraces: tracesToUpgrade,
      },
      {
        onSuccess: () => {
          toaster.create({
            title: "Success",
            description: "Plan successfully updated",
            type: "success",
          });
        },
      }
    );
  };

  const handleCreateSubscription = () => {
    const membersToAdd = selectedMaxMembersPerMonth ?? 0;
    const tracesToAdd = selectedMaxMessagesPerMonth ?? 0;

    trackEvent("subscription_clicked", {
      plan: plan,
      organizationId: organization?.id ?? "",
      planAction: getActionText(activePlan, price ?? "custom"),
    });
    void createSubscription.mutate(
      {
        organizationId: organization?.id ?? "",
        baseUrl: window.location.origin,
        plan: plan,
        membersToAdd: membersToAdd,
        tracesToAdd: tracesToAdd,
      },
      {
        onSuccess: (result: any) => {
          void sendSlackNotification.mutate({
            organizationName: organization?.name ?? "",
            organizationId: organization?.id ?? "",
            plan: plan,
          });
          window.location.href = result.url;
        },
        onError: () => {
          toaster.create({
            title: "Error",
            description:
              "An error occurred trying to subscribe. Please try again.",
            type: "error",
            duration: 5000,
            meta: {
              dismissible: true,
            },
          });
        },
      }
    );
  };

  return (
    <Card.Root
      hidden={hidden}
      border="1px solid"
      borderColor="gray.300"
      cursor="pointer"
      background={selectedPlan == plan ? "gray.50" : "white"}
      borderTop="0px"
      borderRadius="12px 12px 0 0"
      minWidth="300px"
      height="100%"
      zIndex={1}
      onClick={() => {
        setSelectedPlan(plan);
      }}
    >
      <VStack
        align="start"
        width="full"
        padding={6}
        gap={3}
        height="100%"
        justifyContent="space-between"
        position="relative"
        zIndex={10}
        fontSize="14px"
      >
        {recommended && (
          <Tag.Root
            position="absolute"
            top={-2}
            left="50%"
            transform="translateX(-50%)"
            colorPalette="green"
            zIndex={-1}
          >
            <Tag.Label>Recommended</Tag.Label>
          </Tag.Root>
        )}
        {saving && (
          <Box
            position="absolute"
            top={12}
            right={1}
            color="green"
            fontSize="xs"
            paddingX={2}
          >
            {saving}
          </Box>
        )}
        {lifetimeDealOriginalPrice && (
          <HStack
            position="absolute"
            top={12}
            right={1}
            color="green"
            fontSize="xs"
            paddingX={2}
            gap={1}
          >
            <s>€ {lifetimeDealOriginalPrice}</s>
            <Text>limited offer</Text>
          </HStack>
        )}
        <VStack width="full" align="start">
          <VStack align="start" width="full" gap={0} paddingBottom={4}>
            <HStack align="start" gap={3}>
              <VStack gap={4} align="start" paddingBottom={0}>
                <HStack gap={4}>
                  <Heading size="lg" as="h2">
                    {name}
                  </Heading>
                </HStack>
              </VStack>
            </HStack>

            {price === "custom" ? null : (
              <VStack gap="0">
                {plan === "ENTERPRISE" && (
                  <Text alignSelf="start" marginTop="3px" color="gray.500">
                    starting at
                  </Text>
                )}
                <HStack
                  gap="2px"
                  fontSize="18px"
                  color="gray.600"
                  marginTop="-4px"
                >
                  <Text alignSelf="start" marginTop="3px">
                    €
                  </Text>
                  <Text fontSize="22px">
                    {typeof totalCost === "number"
                      ? totalCost.toFixed(2)
                      : totalCost}
                  </Text>
                  <Text alignSelf="end" marginBottom="3px">
                    {isAnnual ? "/yr" : "/mo"}
                  </Text>
                  {isCurrentPlan && (
                    <Tag.Root colorPalette="green" marginLeft={2}>
                      <Tag.Label>Current Plan</Tag.Label>
                    </Tag.Root>
                  )}
                </HStack>
              </VStack>
            )}
          </VStack>

          {features.map((feature, index) => (
            <Feature key={`feature-${index}`} label={feature as string} />
          ))}

          {additionalCosts && (
            <>
              <Text fontWeight="bold" marginTop="20px">
                Add-On Costs:
              </Text>
              {additionalCosts?.map((cost) => <Text key={cost}>{cost}</Text>)}
            </>
          )}
          {plan !== "ENTERPRISE" && plan !== "FREE" && (
            <PlanCard
              selectedMaxMessagesPerMonth={selectedMaxMessagesPerMonth ?? 0}
              selectedMaxMembersPerMonth={selectedMaxMembersPerMonth ?? 0}
              handleMaxMessagesChange={handleMaxMessagesChange}
              handleMaxMembersChange={handleMaxMembersChange}
              minTraces={minTraces}
              minMembers={minMembers}
              maxTraces={maxTraces}
              maxMembers={maxMembers}
              traceStep={traceStep}
            />
          )}
        </VStack>
        {isCurrentPlan && (
          <Button
            colorPalette="green"
            hidden={!canUpgrade()}
            onClick={handleUpgradeOptions}
            loading={addTeamMemberOrTraces.isLoading}
            width="full"
          >
            Update Plan
          </Button>
        )}
        {isCurrentPlan && !canUpgrade() && (
          <Button
            colorPalette="green"
            loading={manageSubscription.isLoading}
            width="full"
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
                    toaster.create({
                      title: "Error",
                      description:
                        "An error occurred trying to manage your subscription. Please try again.",
                      type: "error",
                      duration: 5000,
                      meta: {
                        dismissible: true,
                      },
                    });
                  },
                }
              );
            }}
          >
            Manage Billing
          </Button>
        )}
        {!isCurrentPlan && (
          <HStack width="full">
            {plan !== "ENTERPRISE" ? (
              <Button
                colorPalette="green"
                width="full"
                loading={createSubscription.isLoading}
                onClick={handleCreateSubscription}
              >
                {getActionText(activePlan, price ?? "custom")}
              </Button>
            ) : (
              <Link
                href="https://calendly.com/langwatch/30min"
                target="_blank"
                width="full"
              >
                <Button colorPalette="green" width="full">
                  Schedule a Call
                </Button>
              </Link>
            )}
          </HStack>
        )}
      </VStack>
    </Card.Root>
  );
}

const getActionText = (activePlan: any, price: number | "custom") => {
  return !activePlan?.data || activePlan.data.free
    ? "Subscribe"
    : price !== "custom" && (price ?? 0) < activePlan.data.prices.EUR
    ? "Downgrade"
    : "Upgrade";
};

function Feature({ label, key }: { label: string; key: string }) {
  return (
    <HStack key={key} gap={2}>
      <Check size={16} color="green" strokeWidth={3} />
      <Text>{label}</Text>
    </HStack>
  );
}

function PlanCard({
  selectedMaxMembersPerMonth,
  handleMaxMembersChange,
  selectedMaxMessagesPerMonth,
  handleMaxMessagesChange,
  minTraces,
  maxTraces,
  minMembers,
  maxMembers,
  traceStep,
}: {
  selectedMaxMembersPerMonth: number;
  handleMaxMembersChange: (maxMembers: number) => void;
  selectedMaxMessagesPerMonth: number;
  handleMaxMessagesChange: (maxMessagesPerMonth: number) => void;
  minTraces?: number;
  maxTraces?: number;
  minMembers?: number;
  maxMembers?: number;
  traceStep?: number;
}) {
  return (
    <Card.Root width="full" marginY={4}>
      <Card.Body>
        <VStack width="full" justifyContent="space-between" align="start">
          <Text>
            <b>Customize your plan:</b>
          </Text>

          <>
            <HStack gap={2} width="full">
              <Slider.Root
                size="sm"
                width="full"
                defaultValue={[40]}
                value={[selectedMaxMembersPerMonth ?? 0]}
                onValueChange={({ value }) => {
                  handleMaxMembersChange(value[0] ?? 0);
                }}
                max={maxMembers ?? 0}
                min={minMembers ?? 0}
                step={1}
              >
                <HStack justify="space-between">
                  <Slider.Label>Team Members</Slider.Label>
                  <Slider.ValueText />
                </HStack>
                <Slider.Control>
                  <Slider.Track>
                    <Slider.Range />
                  </Slider.Track>
                  <Slider.Thumb index={0} />
                </Slider.Control>
              </Slider.Root>
            </HStack>
            <HStack gap={2} width="full">
              <Slider.Root
                size="sm"
                width="full"
                value={[selectedMaxMessagesPerMonth ?? 0]}
                onValueChange={({ value }) => {
                  handleMaxMessagesChange(value[0] ?? 0);
                }}
                min={minTraces ?? 0}
                step={traceStep ?? 10000}
                max={maxTraces ?? 0}
              >
                <HStack justify="space-between">
                  <Slider.Label>Traces</Slider.Label>
                  <Slider.ValueText />
                </HStack>
                <Slider.Control>
                  <Slider.Track>
                    <Slider.Range />
                  </Slider.Track>
                  <Slider.Thumb index={0} />
                </Slider.Control>
              </Slider.Root>
            </HStack>
          </>
        </VStack>
      </Card.Body>
    </Card.Root>
  );
}
