import {
  Box,
  Button,
  Flex,
  Grid,
  Heading,
  HStack,
  Spinner,
  Text,
  VStack,
} from "@chakra-ui/react";
import { ArrowLeft, Info } from "lucide-react";
import { useState } from "react";
import { Link } from "~/components/ui/link";
// The page's display voice (Sentient) is declared in langyTheme.css. Imported
// HERE, the way the home page does it, because no Langy or auth-screen surface
// mounts inside settings and the face would otherwise fall back to a plain
// serif on the one screen inside the product that is selling something.
import "~/features/langy/langyTheme.css";
import { HEADING_FONT, SHAPE } from "~/features/auth/authTheme";
import { Currency as PrismaCurrency } from "~/generated/prisma/client";
import { api } from "~/utils/api";
import type { BillingInterval, Currency } from "../subscription/billing-plans";
import { PlanCard, type PlanStanding } from "./PlanCard";
import { PlanControls } from "./PlanControls";
import { getNextPlan, getPlanColumns } from "./planColumns";
import {
  type ComparisonPlanId,
  resolveCurrentComparisonPlan,
} from "./planCurrentResolver";

/** The public list of every event type that counts toward the usage lines below. */
const BILLABLE_EVENTS_DOCS_URL =
  "https://docs.langwatch.ai/pricing/billable-events";

type PlansComparisonPageProps = {
  activePlan?: {
    type?: string | null;
    free?: boolean | null;
  };
  pricingModel?: string | null;
};

/**
 * The plans row, in the auth screens' language.
 *
 * This is a settings page and it stays one — the app's own layout, its colour
 * modes, its tokens — but it is also the only screen inside the product that
 * is selling something, so it borrows the vocabulary of the screen people
 * arrive on: the site's serif for the headings, the brand orange for exactly
 * one action, warm tint for the plan the organization already holds, and
 * hairlines for everything else.
 *
 * Nothing here decides anything. The plan the reader is on comes from
 * `resolveCurrentComparisonPlan`, the figures from the Stripe catalogue
 * through `planColumns`, and the bullets from `billing-plans`. What this file
 * owns is which of those the eye reaches first.
 */
export function PlansComparisonPage({
  activePlan,
  pricingModel,
}: PlansComparisonPageProps) {
  const currentPlan = resolveCurrentComparisonPlan(activePlan);
  const showTieredNotice = pricingModel === "TIERED" && !activePlan?.free;

  const detectedCurrency = api.currency.detectCurrency.useQuery({});
  const [selectedCurrency, setSelectedCurrency] = useState<Currency | null>(
    null,
  );
  const currency =
    selectedCurrency ?? detectedCurrency.data?.currency ?? PrismaCurrency.EUR;
  const [billingPeriod, setBillingPeriod] =
    useState<BillingInterval>("monthly");

  if (detectedCurrency.isLoading) {
    return <Spinner />;
  }

  return (
    <VStack
      gap={6}
      width="full"
      align="stretch"
      maxWidth="1000px"
      marginX="auto"
    >
      <PlansMasthead
        billingPeriod={billingPeriod}
        onBillingPeriodChange={setBillingPeriod}
        currency={currency}
        onCurrencyChange={setSelectedCurrency}
      />

      {showTieredNotice ? <DiscontinuedPricingNotice /> : null}

      <PlanRow
        currentPlan={currentPlan}
        currency={currency}
        billingPeriod={billingPeriod}
      />
    </VStack>
  );
}

/**
 * The way back, the title, the sentence under it, and the two switches that
 * change what the figures say — the switches beside the title rather than
 * centred on a row of their own, where they read as the settings for the row
 * underneath.
 */
function PlansMasthead({
  billingPeriod,
  onBillingPeriodChange,
  currency,
  onCurrencyChange,
}: {
  billingPeriod: BillingInterval;
  onBillingPeriodChange: (billingPeriod: BillingInterval) => void;
  currency: Currency;
  onCurrencyChange: (currency: Currency) => void;
}) {
  return (
    <VStack align="stretch" gap={4}>
      <Box>
        <Link href="/settings/subscription">
          <Button
            variant="ghost"
            size="sm"
            color="fg.muted"
            borderRadius={SHAPE.action}
            paddingInline={3}
            marginInlineStart={-3}
            _hover={{ color: "fg", backgroundColor: "bg.muted" }}
          >
            <ArrowLeft size={14} /> Subscription
          </Button>
        </Link>
      </Box>

      <Flex
        direction={{ base: "column", md: "row" }}
        justifyContent="space-between"
        alignItems={{ base: "stretch", md: "flex-end" }}
        gap={4}
      >
        <VStack align="start" gap={1} maxWidth="46ch">
          <Heading
            as="h2"
            fontFamily={HEADING_FONT}
            fontWeight={400}
            fontSize={{ base: "30px", md: "38px" }}
            lineHeight="1.1"
            letterSpacing="-0.02em"
            color="fg"
          >
            Plans
          </Heading>
          <Text color="fg.muted" fontSize="15px">
            Compare plans and choose the right tier for your organization.
          </Text>
          <Link
            href={BILLABLE_EVENTS_DOCS_URL}
            isExternal
            data-testid="billable-events-docs-link"
            fontSize="13px"
            color="fg.muted"
            display="inline-flex"
            alignItems="center"
            gap={1}
            marginTop={1}
            _hover={{ color: "auth.ink" }}
          >
            <Info size={13} />
            What counts as an event?
          </Link>
        </VStack>

        <PlanControls
          billingPeriod={billingPeriod}
          onBillingPeriodChange={onBillingPeriodChange}
          currency={currency}
          onCurrencyChange={onCurrencyChange}
        />
      </Flex>
    </VStack>
  );
}

/**
 * Said in the brand's own warm tint rather than in a warning colour: the
 * organization is not in trouble, and the sentence is an invitation to move,
 * so it is set like one.
 */
function DiscontinuedPricingNotice() {
  return (
    <HStack
      data-testid="tiered-discontinued-notice"
      gap={3}
      alignItems="start"
      backgroundColor="auth.tint"
      borderWidth={1}
      borderColor="auth.detail"
      borderRadius={SHAPE.card}
      paddingInline={4}
      paddingBlock={3}
    >
      <Box color="auth.ink" flexShrink={0} paddingTop="2px">
        <Info size={16} />
      </Box>
      <Text fontSize="14px" color="fg">
        Your current pricing model has been discontinued.{" "}
        <Link
          href="/settings/subscription"
          fontWeight="600"
          color="auth.ink"
          textDecoration="underline"
          textUnderlineOffset="3px"
        >
          Update your plan
        </Link>{" "}
        to move to seat and usage billing.
      </Text>
    </HStack>
  );
}

/**
 * The row is ONE grid, and each card subgrids its four rows into it, so the
 * names, the figures, the lists and the actions line up across all three
 * columns however much any one of them has to say. Below `md` the cards stack
 * and each keeps its own rows.
 */
function PlanRow({
  currentPlan,
  currency,
  billingPeriod,
}: {
  currentPlan: ComparisonPlanId | null;
  currency: Currency;
  billingPeriod: BillingInterval;
}) {
  const nextPlan = getNextPlan(currentPlan);
  const standingOf = (planId: ComparisonPlanId): PlanStanding => {
    if (currentPlan === planId) return "held";
    return nextPlan === planId ? "offered" : "listed";
  };

  return (
    <Grid
      templateColumns={{ base: "1fr", md: "repeat(3, minmax(0, 1fr))" }}
      templateRows={{ md: "auto auto auto 1fr" }}
      gap={5}
      width="full"
      alignItems="stretch"
    >
      {getPlanColumns(currency).map((plan) => (
        <PlanCard
          key={plan.id}
          plan={plan}
          standing={standingOf(plan.id)}
          currentPlan={currentPlan}
          currency={currency}
          billingPeriod={billingPeriod}
        />
      ))}
    </Grid>
  );
}
