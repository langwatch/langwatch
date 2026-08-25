import { Box, Button, Heading, HStack, Text } from "@chakra-ui/react";
import { Link } from "~/components/ui/link";
import { HEADING_FONT, SHAPE } from "~/features/auth/authTheme";
import type { BillingInterval, Currency } from "../subscription/billing-plans";
import { PlanFeatureList } from "./PlanFeatureList";
import { PriceOdometer } from "./PriceOdometer";
import {
  getPlanAction,
  getPlanPrice,
  type PlanAction,
  type PlanColumn,
} from "./planColumns";
import type { ComparisonPlanId } from "./planCurrentResolver";
import { readPlanFeatures } from "./planFeatureGroups";

/**
 * Where this card stands in relation to the reader.
 *
 * `held` is the plan the organization is on, and it is the one thing the row
 * has to say before anything else: the card is filled with the brand's warm
 * tint and ringed, so it reads as YOURS from across the page rather than as an
 * identical card wearing a badge. `offered` is the tier one step up — the only
 * card that carries the solid orange action, lifted off the row on its own
 * rule and shadow. Everything else is `listed`: present, comparable, quiet.
 */
export type PlanStanding = "held" | "offered" | "listed";

/**
 * Four rows, shared by all three cards through the row's subgrid, so the
 * names, the figures, the actions and the lists each start on one line.
 *
 * The action sits with the FIGURE rather than at the foot of the card. Pinned
 * to the bottom it aligned beautifully and left the shortest column with two
 * hundred pixels of nothing between its last bullet and its button — a hole
 * that read as a layout running out of things to say. Above the list, the
 * price and the thing you do about it are together, every button is on screen
 * without scrolling, and the slack that has to go somewhere collects under the
 * shortest list, where it is just a margin.
 */
const CARD_ROWS = "auto auto auto 1fr";

export function PlanCard({
  plan,
  standing,
  currentPlan,
  currency,
  billingPeriod,
}: {
  plan: PlanColumn;
  standing: PlanStanding;
  currentPlan: ComparisonPlanId | null;
  currency: Currency;
  billingPeriod: BillingInterval;
}) {
  const isHeld = standing === "held";
  const isOffered = standing === "offered";
  const action = getPlanAction({ planId: plan.id, currentPlan });

  return (
    <Box
      data-testid={`plan-column-${plan.id}`}
      position="relative"
      display="grid"
      gridTemplateRows={{ base: CARD_ROWS, md: "subgrid" }}
      gridRow={{ md: "span 4" }}
      rowGap={4}
      overflow="hidden"
      padding={6}
      borderWidth={1}
      borderRadius={SHAPE.card}
      {...cardSurface(standing)}
      transition="transform 180ms ease, box-shadow 240ms ease, border-color 240ms ease"
      _motionReduce={{ transition: "none", _hover: { transform: "none" } }}
    >
      {/* The rule is the row pointing: three pixels of the brand across the
          top of the one tier this organization has not bought yet. */}
      {isOffered ? (
        <Box
          position="absolute"
          insetInline={0}
          top={0}
          height="3px"
          backgroundColor="auth.action"
        />
      ) : null}

      <HStack justifyContent="space-between" alignItems="center" gap={2}>
        <Heading
          as="h3"
          fontFamily={HEADING_FONT}
          fontWeight={500}
          fontSize="23px"
          lineHeight="1.15"
          letterSpacing="-0.01em"
          color="fg"
        >
          {plan.name}
        </Heading>
        {isHeld ? <CurrentPlanBadge /> : null}
      </HStack>

      <PlanPriceBlock
        plan={plan}
        currency={currency}
        billingPeriod={billingPeriod}
      />

      <Box>
        {action ? (
          <PlanActionButton action={action} isPrimary={isOffered} />
        ) : null}
      </Box>

      <Box borderTopWidth={1} borderColor="border.subtle" paddingTop={4}>
        <PlanFeatureList
          features={readPlanFeatures({
            planId: plan.id,
            features: plan.features,
          })}
          accent={isHeld || isOffered}
        />
      </Box>
    </Box>
  );
}

/**
 * The pane itself: fill, edge and the light under it. Held is tinted and
 * ringed, offered is lifted on the brand's own warm throw, and listed is a
 * plain panel behind a hairline. Every card answers a hover the same way —
 * the row is comparable, so nothing may feel more clickable than its
 * neighbour.
 */
function cardSurface(standing: PlanStanding) {
  const offeredShadow =
    "0 18px 40px -28px var(--chakra-colors-auth-glow), 0 2px 6px -3px rgba(20, 20, 23, 0.12)";
  const isQuiet = standing === "listed";

  return {
    borderColor: isQuiet ? "border.emphasized" : "auth.detail",
    // The tint is cut for a badge and an alert, and a whole card's worth of it
    // on a dark ground is a rust field rather than a warm one. On paper it is
    // right as it stands; on ink it is taken down to something the type still
    // sits on comfortably.
    backgroundColor:
      standing === "held"
        ? { base: "auth.tint", _dark: "auth.tint/45" }
        : "bg.panel",
    boxShadow: standing === "offered" ? offeredShadow : "none",
    _hover: {
      transform: "translateY(-3px)",
      boxShadow:
        standing === "offered"
          ? "0 26px 52px -26px var(--chakra-colors-auth-glow), 0 4px 10px -4px rgba(20, 20, 23, 0.16)"
          : "0 16px 34px -26px rgba(20, 20, 23, 0.45)",
    },
  } as const;
}

/**
 * The figure, then the unit, then who the tier is for.
 *
 * The figure is set large and in the app's own face with tabular figures —
 * numbers are utility type, and they have to hold their width while they roll.
 * A tier the catalogue does not price says so in words, at a size those words
 * fit at.
 */
function PlanPriceBlock({
  plan,
  currency,
  billingPeriod,
}: {
  plan: PlanColumn;
  currency: Currency;
  billingPeriod: BillingInterval;
}) {
  const price = getPlanPrice({ planId: plan.id, currency, billingPeriod });

  return (
    <Box>
      <HStack alignItems="baseline" gap={2} color="fg">
        <Text
          as="span"
          fontSize={price.unit ? "34px" : "24px"}
          fontWeight="600"
          letterSpacing="-0.02em"
          lineHeight="1.15"
        >
          <PriceOdometer
            value={price.amount}
            testId={`plan-price-${plan.id}`}
          />
        </Text>
        {price.unit ? (
          <Text as="span" fontSize="13px" color="fg.muted">
            {price.unit}
          </Text>
        ) : null}
      </HStack>
      <Text fontSize="13px" color="fg.muted" marginTop={1}>
        {plan.subtitle}
      </Text>
    </Box>
  );
}

function CurrentPlanBadge() {
  return (
    <Box
      backgroundColor="auth.action"
      color="auth.onAction"
      borderRadius="full"
      paddingInline="10px"
      paddingBlock="3px"
      fontSize="10px"
      fontWeight="700"
      letterSpacing="0.09em"
      textTransform="uppercase"
      whiteSpace="nowrap"
    >
      Current
    </Box>
  );
}

/**
 * The card's one ask.
 *
 * Solid orange on the tier being offered and a quiet outline everywhere else,
 * so the row has exactly one thing lit at a time. The lift and the warm throw
 * under the pill are the auth screens' own press, kept to the same values so
 * the two surfaces answer a click the same way.
 */
function PlanActionButton({
  action,
  isPrimary,
}: {
  action: PlanAction;
  isPrimary: boolean;
}) {
  return (
    <Button
      asChild
      width="full"
      height="40px"
      borderRadius={SHAPE.action}
      fontSize="14px"
      fontWeight="600"
      variant={isPrimary ? "solid" : "outline"}
      borderWidth={1}
      transition="transform 140ms ease, box-shadow 260ms ease, background-color 200ms ease"
      {...(isPrimary ? primaryActionSurface : secondaryActionSurface)}
      _active={{ transform: "translateY(0.5px)" }}
      _focusVisible={{
        outline: "2px solid",
        outlineColor: "auth.detail",
        outlineOffset: "2px",
      }}
      _motionReduce={{
        transition: "none",
        _hover: { transform: "none" },
        _active: { transform: "none" },
      }}
    >
      <Link href={action.href} isExternal={action.isExternal}>
        {action.label}
      </Link>
    </Button>
  );
}

const primaryActionSurface = {
  backgroundColor: "auth.action",
  color: "auth.onAction",
  borderColor: "transparent",
  backgroundImage:
    "linear-gradient(180deg, rgba(255, 255, 255, 0.14), rgba(255, 255, 255, 0) 55%)",
  boxShadow:
    "inset 0 1px 0 rgba(255, 255, 255, 0.2), 0 1px 2px rgba(12, 8, 5, 0.1), 0 10px 26px -14px var(--chakra-colors-auth-glow)",
  _hover: {
    backgroundColor: "auth.actionHover",
    transform: "translateY(-1px)",
    boxShadow:
      "inset 0 1px 0 rgba(255, 255, 255, 0.24), 0 2px 4px rgba(12, 8, 5, 0.12), 0 8px 26px -8px var(--chakra-colors-auth-glow)",
  },
} as const;

const secondaryActionSurface = {
  backgroundColor: "transparent",
  color: "fg",
  borderColor: "border.emphasized",
  _hover: {
    backgroundColor: "bg.muted",
    borderColor: "fg.subtle",
    transform: "translateY(-1px)",
  },
} as const;
