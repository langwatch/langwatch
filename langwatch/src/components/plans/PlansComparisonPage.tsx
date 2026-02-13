import { useState } from "react";
import {
  Badge,
  Box,
  Button,
  Card,
  Heading,
  HStack,
  SimpleGrid,
  Text,
  VStack,
} from "@chakra-ui/react";
import { Check, CircleDollarSign, DollarSign, Euro, Info } from "lucide-react";
import { Link } from "~/components/ui/link";
import {
  type ComparisonPlanId,
  resolveCurrentComparisonPlan,
} from "./planCurrentResolver";
import {
  type Currency,
  SEAT_PRICE,
  ANNUAL_DISCOUNT,
  currencySymbol,
} from "../subscription/billing-plans";

type PlanColumn = {
  id: ComparisonPlanId;
  name: string;
  subtitle: string;
  actionLabel: string;
  actionHref: string;
  actionColor: "blue" | "orange";
  features: string[];
};

const PLAN_COLUMNS: PlanColumn[] = [
  {
    id: "free",
    name: "Free",
    subtitle: "For teams getting started",
    actionLabel: "Get Started",
    actionHref: "/settings/subscription",
    actionColor: "blue",
    features: [
      "All platform features",
      "50,000 events included",
      "14 days data retention",
      "2 users",
      "3 scenarios, 3 simulations, 3 custom evaluations",
    ],
  },
  {
    id: "growth",
    name: "Growth",
    subtitle: "Seat and usage pricing for growing teams",
    actionLabel: "Get Started",
    actionHref: "/settings/subscription",
    actionColor: "orange",
    features: [
      "Everything in Free",
      "200,000 events included",
      "$1 per additional 100,000 events",
      "30 days retention (+ custom at $3/GB)",
      "Up to 20 core users (volume discount available)",
      "Unlimited lite users",
      "Unlimited evals, simulations and prompts",
    ],
  },
  {
    id: "enterprise",
    name: "Enterprise",
    subtitle: "Regulated and high-volume deployments",
    actionLabel: "Talk to Sales",
    actionHref: "mailto:sales@langwatch.ai",
    actionColor: "blue",
    features: [
      "Alternative hosting options",
      "Custom data retention",
      "Custom SSO / RBAC",
      "Audit logs",
      "Uptime & Support SLA",
      "Compliance and legal reviews",
      "Custom terms and DPA",
    ],
  },
];

type PlansComparisonPageProps = {
  activePlan?: {
    type?: string | null;
    free?: boolean | null;
  };
  pricingModel?: string | null;
};

function getPlanPrice(
  planId: ComparisonPlanId,
  currency: Currency,
  billingPeriod: "monthly" | "annually",
): string {
  if (planId === "free") return `${currencySymbol[currency]}0 per user/month`;
  if (planId === "growth") {
    const base = SEAT_PRICE[currency];
    const price =
      billingPeriod === "annually"
        ? Math.round(base * (1 - ANNUAL_DISCOUNT))
        : base;
    return `${currencySymbol[currency]}${price} per seat/month`;
  }
  return "Custom pricing";
}

function PlanCardActions({
  plan,
  currentPlan,
}: {
  plan: PlanColumn;
  currentPlan: ComparisonPlanId | null;
}) {
  if (plan.id === "free") {
    return null;
  }

  if (plan.id === "growth") {
    if (currentPlan === "growth") {
      return (
        <VStack width="full" gap={2}>
          <Button asChild width="full" colorPalette="orange" variant="solid">
            <Link href="/settings/members">Add Members</Link>
          </Button>
        </VStack>
      );
    }

    return (
      <Button asChild width="full" colorPalette="orange" variant="solid">
        <Link color="emphasized" href="/settings/subscription">
          Upgrade Now
        </Link>
      </Button>
    );
  }

  if (plan.id === "enterprise" && currentPlan !== "enterprise") {
    return (
      <Button asChild width="full" colorPalette="muted" variant="outline">
        <Link href="mailto:sales@langwatch.ai" isExternal>
          Talk to Sales
        </Link>
      </Button>
    );
  }

  return null;
}

function PlanCard({
  plan,
  isCurrent,
  currentPlan,
  currency,
  billingPeriod,
}: {
  plan: PlanColumn;
  isCurrent: boolean;
  currentPlan: ComparisonPlanId | null;
  currency: Currency;
  billingPeriod: "monthly" | "annually";
}) {
  return (
    <Card.Root
      data-testid={`plan-column-${plan.id}`}
      borderWidth={1}
      borderColor="border.emphasized"
      bg="bg.panel"
      borderRadius="2xl"
      height="full"
      transition="all 0.2s ease-in-out"
      _hover={{
        transform: "scale(1.02)",
        boxShadow: "lg",
      }}
    >
      <Card.Body paddingY={5} paddingX={6}>
        <VStack align="stretch" gap={5} height="full">
          <VStack align="start" gap={1}>
            <HStack gap={2}>
              <Heading as="h2" size="xl">
                {plan.name}
              </Heading>
              {isCurrent && (
                <Badge colorPalette="green" variant="surface" size={"lg"}>
                  Current
                </Badge>
              )}
            </HStack>
            <Text color="fg" fontSize="md" fontWeight="medium">
              {getPlanPrice(plan.id, currency, billingPeriod)}
            </Text>
            <Text color="fg.muted" fontSize="sm">
              {plan.subtitle}
            </Text>
          </VStack>

          <VStack align="start" gap={2} flex={1}>
            {plan.features.map((feature) => (
              <HStack key={feature} align="start" gap={2}>
                <Check
                  size={14}
                  style={{ marginTop: "4px", flexShrink: 0 }}
                  color="var(--chakra-colors-blue-500)"
                />
                <Text fontSize="sm" color="fg.muted">
                  {feature}
                </Text>
              </HStack>
            ))}
          </VStack>

          <VStack width="full" marginTop="auto">
            <PlanCardActions plan={plan} currentPlan={currentPlan} />
          </VStack>
        </VStack>
      </Card.Body>
    </Card.Root>
  );
}

export function PlansComparisonPage({
  activePlan,
  pricingModel,
}: PlansComparisonPageProps) {
  const currentPlan = resolveCurrentComparisonPlan(activePlan);
  const showTieredNotice = pricingModel === "TIERED";

  const [currency, setCurrency] = useState<Currency>("USD");
  const [billingPeriod, setBillingPeriod] = useState<"monthly" | "annually">(
    "monthly",
  );

  return (
    <VStack
      gap={6}
      width="full"
      align="stretch"
      maxWidth="900px"
      marginX="auto"
    >
      <VStack align="center" gap={1}>
        <Heading size="xl" as="h2">
          Plans
        </Heading>
        <Text color="fg.muted">
          Compare plans and choose the right tier for your organization.
        </Text>
      </VStack>

      <HStack
        width="full"
        justifyContent={{ base: "center", md: "center" }}
        flexWrap="wrap"
        gap={3}
      >
        <Box flex={{ md: 1 }} />
        <HStack
          gap={0}
          bg="bg.muted"
          borderRadius="full"
          padding="1"
          data-testid="billing-period-toggle"
        >
          {[
            { label: "Monthly", value: "monthly" as const },
            { label: "Annually", value: "annually" as const },
          ].map((opt) => (
            <Box
              key={opt.value}
              as="button"
              onClick={() => setBillingPeriod(opt.value)}
              paddingX={4}
              paddingY={1.5}
              borderRadius="full"
              fontSize="sm"
              fontWeight={billingPeriod === opt.value ? "semibold" : "normal"}
              color={billingPeriod === opt.value ? "orange.500" : "fg.muted"}
              bg={billingPeriod === opt.value ? "bg.panel" : "transparent"}
              boxShadow={billingPeriod === opt.value ? "xs" : "none"}
              transition="all 0.15s ease-in-out"
              cursor="pointer"
              _hover={{
                color: billingPeriod === opt.value ? "orange.500" : "fg",
              }}
            >
              {opt.label}
            </Box>
          ))}
        </HStack>
        <Box flex={{ md: 1 }} display="flex" justifyContent="flex-end">
          <Button
            data-testid="currency-toggle"
            variant="subtle"
            size="sm"
            _hover={{
              bgColor: "orange.400",
              color: "bg.muted",
            }}
            onClick={() => setCurrency(currency === "EUR" ? "USD" : "EUR")}
          >
            {currency === "EUR" ? <Euro size={14} /> : <DollarSign size={14} />}
            {currency}
          </Button>
        </Box>
      </HStack>

      {showTieredNotice && (
        <Box
          data-testid="tiered-discontinued-notice"
          backgroundColor="orange.50"
          borderWidth={1}
          borderColor="orange.200"
          borderRadius="md"
          padding={4}
        >
          <HStack gap={2} alignItems="start">
            <Info size={16} color="var(--chakra-colors-orange-500)" />
            <Text fontSize="sm" color="orange.900">
              Your current pricing model has been discontinued.{" "}
              <Link
                href="/settings/subscription"
                fontWeight="semibold"
                color="orange.700"
                _hover={{ color: "orange.900" }}
              >
                Update your plan
              </Link>{" "}
              to move to seat and usage billing.
            </Text>
          </HStack>
        </Box>
      )}

      <SimpleGrid columns={{ base: 1, md: 3 }} gap={4}>
        {PLAN_COLUMNS.map((plan) => (
          <PlanCard
            key={plan.id}
            plan={plan}
            isCurrent={currentPlan === plan.id}
            currentPlan={currentPlan}
            currency={currency}
            billingPeriod={billingPeriod}
          />
        ))}
      </SimpleGrid>
    </VStack>
  );
}
