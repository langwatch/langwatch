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
  Spacer,
  Spinner,
  Tag,
  Text,
  VStack,
} from "@chakra-ui/react";
// @ts-ignore
import { useEffect, useMemo, useState, type ReactNode } from "react";

import { captureException } from "~/utils/posthogErrorCapture";
import { trackEvent } from "~/utils/tracking";

import { Check } from "react-feather";
import SettingsLayout from "~/components/SettingsLayout";
import { Switch } from "~/components/ui/switch";
import { toaster } from "~/components/ui/toaster";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { api } from "~/utils/api";
import type { Subscription } from "@prisma/client";
import { useRouter } from "next/router";
import type { PlanTypes } from "../planTypes";

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
              name="Developer"
              price={0}
              description="Get Started with LLM Monitoring and Evaluation"
              features={[
                "All platform features",
                "1000 traces / month included, additional: €5 / 10k traces",
                "30 days data access",
                "2 users",
                "Community Support (Github & Discord)",
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
              description="For small teams optimizing their LLM apps"
              features={[
                "Everything in Developer",
                "20k traces / month included, (around 120k events), additional: €5pm / 10,000 traces",
                "180 days data access",
                "3 users, additional: €19pm/user",
                "Unlimited Evaluations",
                "Unlimited Optimizations",
                "Slack and Email Support",
              ]}
              additionalCosts={[
                "Additional Traces - €5pm/10,000",
                "Additional Users - €19pm/user",
              ]}
              additionalUserCost={19}
              additionalTracesCost={5}
              minTraces={20000}
              minMembers={3}
              maxTraces={1000000}
              maxMembers={10}
              selectedPlan={selectedPlan}
              setSelectedPlan={setSelectedPlan}
              traceStep={10000}
            />
            <Plan
              plan="LAUNCH_ANNUAL"
              name="Launch"
              // saving={"8% saving"}
              isAnnual={billAnnually}
              hidden={!billAnnually}
              price={649}
              description="For small teams optimizing their LLM apps"
              features={[
                "Everything in Developer",
                "20k traces / month included, (around 120k events), additional: €55yr / 10,000 traces(pm)",
                "180 days data access",
                "3 users, additional: €210yr / user",
                "Unlimited Evaluations",
                "Unlimited Optimizations",
                "Slack and Email Support",
              ]}
              additionalCosts={[
                "Additional Traces - €55pa/10,000",
                "Additional Users - €210pa/user",
              ]}
              additionalUserCost={210}
              additionalTracesCost={55}
              minTraces={20000}
              minMembers={3}
              maxTraces={100000}
              maxMembers={10}
              selectedPlan={selectedPlan}
              setSelectedPlan={setSelectedPlan}
              traceStep={10000}
            />
            <Plan
              plan="ACCELERATE"
              name="Accelerate"
              recommended={true}
              hidden={billAnnually}
              price={199}
              description="Dedicated support and security controls for larger teams"
              features={[
                "Everything in Launch",
                "20k traces / month included, (around 120k events), additional: €45 / 100k traces",
                "Up to 2 years data retention",
                "5 users, additional: €10 / user",
                "ISO27001 reports",
              ]}
              additionalCosts={[
                "Additional Traces - €45pm/100,000",
                "Additional Users - €10pm/user",
              ]}
              scaleUpFeatures={[
                "Enterprise SSO",
                "Hybrid Hosting (bring your own database)",
                "Custom Data Retention",
                "Auditing Logs",
                "Dedicated Technical Support",
              ]}
              selectedPlan={selectedPlan}
              setSelectedPlan={setSelectedPlan}
              additionalUserCost={10}
              additionalTracesCost={45}
              minTraces={20000}
              minMembers={5}
              maxTraces={20000000}
              maxMembers={50}
              traceStep={100000}
            />
            <Plan
              plan="ACCELERATE_ANNUAL"
              isAnnual={billAnnually}
              hidden={!billAnnually}
              recommended={true}
              // saving={"12% saving"}
              price={2199}
              name="Accelerate"
              description="For business with multiple teams working with LLMs"
              features={[
                "Everything in Launch",
                "20k traces / month included, (around 120k events), additional: €499yr / 100k traces(pm)",
                "Up to 2 years data retention",
                "5 users, additional: €110yr / user",
                "ISO27001 reports",
              ]}
              additionalCosts={[
                "Additional Traces - €45pm/100,000",
                "Additional Users - €10pm/user",
              ]}
              scaleUpFeatures={[
                "Enterprise SSO",
                "Hybrid Hosting (bring your own database)",
                "Custom Data Retention",
                "Auditing Logs",
                "Dedicated Technical Support",
              ]}
              selectedPlan={selectedPlan}
              setSelectedPlan={setSelectedPlan}
              additionalUserCost={110}
              additionalTracesCost={499}
              minTraces={20000}
              minMembers={5}
              maxTraces={20000000}
              maxMembers={50}
              traceStep={100000}
            />
            <Plan
              plan="ENTERPRISE"
              name="Enterprise"
              isAnnual={billAnnually}
              price="custom"
              description="Self-hosting, enterprise-grade support and security features"
              features={[
                "Everything in Accelerate",
                "Custom traces",
                "Custom data retention",
                "Custom users",
                "Uptime & Support SLA",
                "Custom Terms and SLA",
                "Dedicated Support Engineer",
                "Optional Billing via AWS Marketplace",
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
  scaleUpFeatures,
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
  scaleUpFeatures?: string[];
}) {
  const { organization } = useOrganizationTeamProject();
  const activePlan = api.plan.getActivePlan.useQuery(
    { organizationId: organization?.id ?? "" },
    { enabled: !!organization }
  );
  const createSubscription = (api as any).subscription.create.useMutation();

  const sendProspectiveNotification = (
    api as any
  ).subscription.prospective.useMutation();

  const isCurrentPlan = activePlan.data?.type === plan;

  // Calculate default values based on current plan or minimums
  const defaultMaxMembers = useMemo(() => {
    if (isCurrentPlan && activePlan.data?.maxMembers) {
      return Math.max(
        minMembers ?? 0,
        activePlan.data.maxMembers ?? minMembers ?? 0
      );
    }
    return Math.max(
      minMembers ?? 0,
      activePlan.data?.maxMembers ?? minMembers ?? 0
    );
  }, [isCurrentPlan, activePlan.data?.maxMembers, minMembers]);

  const defaultMaxMessages = useMemo(() => {
    if (isCurrentPlan && activePlan.data?.maxMessagesPerMonth) {
      return Math.max(
        minTraces ?? 0,
        activePlan.data.maxMessagesPerMonth ?? minTraces ?? 0
      );
    }
    return Math.max(
      minTraces ?? 0,
      activePlan.data?.maxMessagesPerMonth ?? minTraces ?? 0
    );
  }, [isCurrentPlan, activePlan.data?.maxMessagesPerMonth, minTraces]);

  const [selectedMaxMembersPerMonth, setSelectedMaxMembersPerMonth] =
    useState(defaultMaxMembers);
  const [selectedMaxMessagesPerMonth, setSelectedMaxMessagesPerMonth] =
    useState(defaultMaxMessages);

  // Minimal useEffect to sync values when current plan changes
  useEffect(() => {
    if (
      isCurrentPlan &&
      activePlan.data?.maxMembers !== undefined &&
      activePlan.data?.maxMessagesPerMonth !== undefined
    ) {
      const newMaxMembers = Math.max(
        minMembers ?? 0,
        activePlan.data.maxMembers ?? minMembers ?? 0
      );
      const newMaxMessages = Math.max(
        minTraces ?? 0,
        activePlan.data.maxMessagesPerMonth ?? minTraces ?? 0
      );
      setSelectedMaxMembersPerMonth(newMaxMembers);
      setSelectedMaxMessagesPerMonth(newMaxMessages);
    }
  }, [
    isCurrentPlan,
    activePlan.data?.maxMembers,
    activePlan.data?.maxMessagesPerMonth,
    minMembers,
    minTraces,
  ]);

  // Calculate costs directly using useMemo
  const { userCost, tracesCost, totalCost } = useMemo(() => {
    try {
      const rawUserCost =
        (selectedMaxMembersPerMonth - (minMembers ?? 0)) *
        (additionalUserCost ?? 0);
      const rawTracesCost =
        ((selectedMaxMessagesPerMonth - (minTraces ?? 0)) *
          (additionalTracesCost ?? 0)) /
        (traceStep ?? 10000);

      const calculatedUserCost = Math.max(0, rawUserCost);
      const calculatedTracesCost = Math.max(0, rawTracesCost);

      // Track if we had to cap negative values
      if (rawUserCost < 0) {
        captureException(new Error("Negative user cost calculated"), {
          extra: {
            selectedMaxMembersPerMonth,
            minMembers,
            additionalUserCost,
            rawUserCost,
            plan,
            organizationId: organization?.id,
          },
          tags: { component: "Subscription", issue: "negative_user_cost" },
        });
      }

      if (rawTracesCost < 0) {
        captureException(new Error("Negative traces cost calculated"), {
          extra: {
            selectedMaxMessagesPerMonth,
            minTraces,
            additionalTracesCost,
            traceStep,
            rawTracesCost,
            plan,
            organizationId: organization?.id,
          },
          tags: { component: "Subscription", issue: "negative_traces_cost" },
        });
      }

      // Track if selected values are below minimums
      if (
        selectedMaxMembersPerMonth < (minMembers ?? 0) ||
        selectedMaxMessagesPerMonth < (minTraces ?? 0)
      ) {
        captureException(new Error("Selected values below plan minimums"), {
          extra: {
            selectedMaxMembersPerMonth,
            minMembers,
            selectedMaxMessagesPerMonth,
            minTraces,
            plan,
            organizationId: organization?.id,
            activePlanMaxMembers: activePlan.data?.maxMembers,
            activePlanMaxMessages: activePlan.data?.maxMessagesPerMonth,
          },
          tags: {
            component: "Subscription",
            issue: "values_below_minimum",
          },
        });
      }

      const basePrice = typeof price === "number" ? price : 0;
      const calculatedTotalCost =
        basePrice + calculatedUserCost + calculatedTracesCost;

      return {
        userCost: calculatedUserCost,
        tracesCost: calculatedTracesCost,
        totalCost: calculatedTotalCost,
      };
    } catch (error) {
      captureException(error, {
        extra: {
          selectedMaxMembersPerMonth,
          minMembers,
          selectedMaxMessagesPerMonth,
          minTraces,
          plan,
          organizationId: organization?.id,
        },
        tags: { component: "Subscription", issue: "cost_calculation_error" },
      });
      return {
        userCost: 0,
        tracesCost: 0,
        totalCost: typeof price === "number" ? price : 0,
      };
    }
  }, [
    selectedMaxMembersPerMonth,
    minMembers,
    additionalUserCost,
    selectedMaxMessagesPerMonth,
    minTraces,
    additionalTracesCost,
    traceStep,
    price,
    plan,
    organization?.id,
    activePlan.data?.maxMembers,
    activePlan.data?.maxMessagesPerMonth,
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
        onError: (error: unknown) => {
          captureException(error, {
            extra: {
              organizationId: organization?.id ?? "",
              plan: activePlan.data?.type ?? "FREE",
              upgradeMembers,
              upgradeTraces,
              totalMembers: membersToUpgrade,
              totalTraces: tracesToUpgrade,
            },
            tags: {
              component: "Subscription",
              issue: "add_team_member_or_traces_error",
            },
          });
          toaster.create({
            title: "Error",
            description:
              "An error occurred updating your plan. Please try again.",
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
        onSuccess: async (result: any) => {
          try {
            await sendProspectiveNotification.mutateAsync({
              organizationId: organization?.id ?? "",
              plan: plan,
            });
          } catch (error) {
            // Silent error tracking - Slack notification failure shouldn't block user
            captureException(error, {
              extra: {
                organizationId: organization?.id ?? "",
                organizationName: organization?.name ?? "",
                plan,
              },
              tags: {
                component: "Subscription",
                issue: "slack_notification_error",
              },
            });
          } finally {
            window.location.href = result.url;
          }
        },
        onError: (error: unknown) => {
          captureException(error, {
            extra: {
              organizationId: organization?.id ?? "",
              plan,
              membersToAdd,
              tracesToAdd,
              baseUrl: window.location.origin,
              activePlanType: activePlan.data?.type,
            },
            tags: {
              component: "Subscription",
              issue: "create_subscription_error",
            },
          });
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

            {price === "custom" ? (
              <Text fontSize="18px">Custom</Text>
            ) : (
              <VStack gap="0">
                <HStack
                  gap="2px"
                  fontSize="18px"
                  color="gray.600"
                  marginTop="-4px"
                >
                  {totalCost != 0 ? (
                    <>
                      <Text fontSize="22px">
                        €
                        {typeof totalCost === "number"
                          ? totalCost.toFixed(2)
                          : totalCost}
                      </Text>
                      <Text alignSelf="end" marginBottom="3px">
                        {isAnnual ? "/yr" : "/mo"}
                      </Text>
                    </>
                  ) : (
                    <Text fontSize="22px">Free</Text>
                  )}

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

          {scaleUpFeatures && (
            <VStack
              gap={2}
              align="start"
              border="1px solid lightgray"
              padding={2}
              borderRadius="md"
              paddingTop={0}
              marginTop={4}
            >
              <HStack width="full" marginY={2}>
                <Text fontWeight="bold">Scale-up Add-on</Text>
                <Spacer />
                <Text>+€300/mo</Text>
              </HStack>

              {scaleUpFeatures.map((feature, index) => (
                <Feature key={`feature-${index}`} label={feature as string} />
              ))}
            </VStack>
          )}
          {/* {additionalCosts && (
            <>
              <Text fontWeight="bold" marginTop="20px">
                Add-On Costs:
              </Text>
              {additionalCosts?.map((cost) => <Text key={cost}>{cost}</Text>)}
            </>
          )} */}
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
            loading={manageSubscription.isLoading}
            width="full"
            variant="outline"
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
                  onError: (error: unknown) => {
                    captureException(error, {
                      extra: {
                        organizationId: organization?.id ?? "",
                        baseUrl: window.location.origin,
                        activePlanType: activePlan.data?.type,
                      },
                      tags: {
                        component: "Subscription",
                        issue: "manage_subscription_error",
                      },
                    });
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
      <Box
        width="16px"
        height="16px"
        display="flex"
        alignItems="center"
        justifyContent="center"
      >
        <Check size={16} color="green" strokeWidth={3} />
      </Box>
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
