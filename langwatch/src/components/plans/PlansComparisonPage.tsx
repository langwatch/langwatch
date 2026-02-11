import {
  Badge,
  Box,
  Button,
  Card,
  Flex,
  Heading,
  HStack,
  SimpleGrid,
  Table,
  Text,
  VStack,
} from "@chakra-ui/react";
import { Check, Info } from "lucide-react";
import { Link } from "~/components/ui/link";
import {
  type ComparisonPlanId,
  resolveCurrentComparisonPlan,
} from "./planCurrentResolver";

type PlanColumn = {
  id: ComparisonPlanId;
  name: string;
  price: string;
  subtitle: string;
  actionLabel: string;
  actionHref: string;
  actionColor: "blue" | "orange";
  features: string[];
};

type ComparisonRow = {
  id: string;
  label: string;
  free: string;
  growth: string;
  enterprise: string;
};

const PLAN_COLUMNS: PlanColumn[] = [
  {
    id: "free",
    name: "Free",
    price: "$0 per user/month",
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
    price: "$29 per seat/month",
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
    price: "Custom pricing",
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

const USAGE_ROWS: ComparisonRow[] = [
  {
    id: "events-included",
    label: "Events included",
    free: "50,000",
    growth: "200,000",
    enterprise: "Custom",
  },
  {
    id: "extra-event-pricing",
    label: "Extra event pricing",
    free: "-",
    growth: "$1 per additional 100,000 events",
    enterprise: "Custom",
  },
  {
    id: "data-retention",
    label: "Data retention",
    free: "14 days",
    growth: "30 days (+ custom at $3/GB)",
    enterprise: "Custom",
  },
  {
    id: "users",
    label: "Users",
    free: "2 users",
    growth: "Up to 20 core users",
    enterprise: "Custom",
  },
  {
    id: "lite-users",
    label: "Lite users",
    free: "-",
    growth: "Unlimited",
    enterprise: "Unlimited",
  },
  {
    id: "scenarios",
    label: "Scenarios",
    free: "3",
    growth: "Unlimited",
    enterprise: "Unlimited",
  },
  {
    id: "simulation-runs",
    label: "Simulation runs",
    free: "3",
    growth: "Unlimited",
    enterprise: "Unlimited",
  },
  {
    id: "custom-evaluations",
    label: "Custom evaluations",
    free: "3",
    growth: "Unlimited",
    enterprise: "Unlimited",
  },
];

type PlansComparisonPageProps = {
  activePlan?: {
    type?: string | null;
    free?: boolean | null;
  };
  pricingModel?: string | null;
};

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
          <Button
            asChild
            width="full"
            colorPalette="orange"
            variant="solid"
          >
            <Link href="/settings/members">Add Members</Link>
          </Button>
          <Button
            asChild
            width="full"
            colorPalette="orange"
            variant="outline"
          >
            <Link href="/settings/subscription">Add Events</Link>
          </Button>
        </VStack>
      );
    }

    return (
      <Button
        asChild
        width="full"
        colorPalette="orange"
        variant="solid"
      >
        <Link href="/settings/subscription">Upgrade Now</Link>
      </Button>
    );
  }

  if (plan.id === "enterprise" && currentPlan !== "enterprise") {
    return (
      <Button
        asChild
        width="full"
        colorPalette="blue"
        variant="outline"
      >
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
}: {
  plan: PlanColumn;
  isCurrent: boolean;
  currentPlan: ComparisonPlanId | null;
}) {
  return (
    <Card.Root
      data-testid={`plan-column-${plan.id}`}
      borderWidth={1}
      borderColor="border.emphasized"
      bg="bg.panel"
      borderRadius="2xl"
      height="full"
    >
      <Card.Body paddingY={5} paddingX={6}>
        <VStack align="stretch" gap={5} height="full">
          <VStack align="start" gap={1}>
            <HStack gap={2}>
              <Heading as="h2" size="xl">
                {plan.name}
              </Heading>
              {isCurrent && (
                <Badge colorPalette="blue" variant="subtle">
                  Current
                </Badge>
              )}
            </HStack>
            <Text color="fg" fontSize="md" fontWeight="medium">
              {plan.price}
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

  return (
    <VStack
      gap={6}
      width="full"
      align="stretch"
      maxWidth="900px"
      marginX="auto"
    >
      <Flex justifyContent="space-between" alignItems="flex-start">
        <VStack align="start" gap={1}>
          <Heading size="xl" as="h2">
            Plans
          </Heading>
          <Text color="fg.muted">
            Compare plans and choose the right tier for your organization.
          </Text>
        </VStack>
      </Flex>

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
          />
        ))}
      </SimpleGrid>

      <VStack align="stretch" gap={3} width="full">
        <Heading as="h2" size="xl">
          Usage
        </Heading>
        <Table.ScrollArea
          width="full"
          borderRadius="2xl"
          bg="bg.panel"
          overflow="hidden"
        >
          <Table.Root variant="line" width="full" tableLayout="fixed">
            <Table.ColumnGroup>
              <Table.Column width="30%" />
              <Table.Column width="20%" />
              <Table.Column width="30%" />
              <Table.Column width="20%" />
            </Table.ColumnGroup>
            <Table.Header>
              <Table.Row borderBottomWidth={0}>
                <Table.ColumnHeader bg="transparent" color="fg.subtle" borderBottomWidth={0}>
                  Capability
                </Table.ColumnHeader>
                <Table.ColumnHeader bg="transparent" color="fg.subtle" borderBottomWidth={0}>
                  Free
                </Table.ColumnHeader>
                <Table.ColumnHeader bg="transparent" color="fg.subtle" borderBottomWidth={0}>
                  Growth
                </Table.ColumnHeader>
                <Table.ColumnHeader bg="transparent" color="fg.subtle" borderBottomWidth={0}>
                  Enterprise
                </Table.ColumnHeader>
              </Table.Row>
            </Table.Header>
            <Table.Body>
              {USAGE_ROWS.map((row) => (
                <Table.Row
                  key={row.id}
                  data-testid={`comparison-row-${row.id}`}
                  borderBottomWidth={0}
                >
                  <Table.Cell color="fg" borderBottomWidth={0}>{row.label}</Table.Cell>
                  <Table.Cell color="fg" borderBottomWidth={0}>{row.free}</Table.Cell>
                  <Table.Cell color="fg" borderBottomWidth={0}>{row.growth}</Table.Cell>
                  <Table.Cell color="fg" borderBottomWidth={0}>{row.enterprise}</Table.Cell>
                </Table.Row>
              ))}
            </Table.Body>
          </Table.Root>
        </Table.ScrollArea>
      </VStack>
    </VStack>
  );
}
