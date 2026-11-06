import { Link } from "@langwatch/browser-host/link";
/**
 * The active plan: its price, this month's usage against its limits, and the
 * one action that moves it forward (upgrade, manage, or talk to sales).
 * @see specs/licensing/subscription-page.feature
 */
import { Banner } from "@langwatch/design-system/banner";
import { Card } from "@langwatch/design-system/card";
import { MeterBar } from "@langwatch/design-system/meter-bar";
import { Box, Button, HStack, SimpleGrid, Text, VStack } from "@langwatch/design-system/primitives";
import { SettingList, SettingRow, StatusChip } from "@langwatch/design-system/settings-card";
import { Check } from "lucide-react";

import type { PlanEventUsage } from "../../model/subscription-page-state.ts";
import { PricingSummary } from "../../ui/elements/pricing-summary.tsx";

const METER_FILL: Record<PlanEventUsage["status"], string> = {
  ok: "blue.solid",
  warning: "orange.solid",
  exceeded: "red.solid",
};

function EventUsageRow({ usage }: { usage: PlanEventUsage }) {
  return (
    <SettingRow
      label={usage.label}
      hint={
        usage.status === "exceeded"
          ? "New events are not processed until the month resets or you upgrade."
          : undefined
      }
      data-testid="plan-event-usage"
    >
      <Text textStyle="bodySm" fontWeight={600} fontVariantNumeric="tabular-nums">
        {usage.value}
      </Text>
      {usage.fillRatio !== null && (
        <MeterBar
          fillRatio={usage.fillRatio}
          width="96px"
          height="6px"
          fillColor={METER_FILL[usage.status]}
          data-testid="plan-event-meter"
        />
      )}
      {usage.status === "exceeded" && <StatusChip label="Limit reached" tone="bad" />}
      {usage.status === "warning" && <StatusChip label="Close to the limit" tone="warning" />}
    </SettingRow>
  );
}

function PlanActions({
  onUpgrade,
  isUpgradeLoading,
  onManageSubscription,
  isManageLoading,
  contactSalesUrl,
}: {
  onUpgrade?: () => void;
  isUpgradeLoading?: boolean;
  onManageSubscription?: () => void;
  isManageLoading?: boolean;
  contactSalesUrl?: string;
}) {
  if (!onUpgrade && !onManageSubscription && !contactSalesUrl) return null;
  return (
    <HStack gap={2}>
      {onUpgrade && (
        <Button
          data-testid="current-plan-upgrade-button"
          data-emphasis="primary"
          colorPalette="orange"
          size="sm"
          onClick={onUpgrade}
          loading={isUpgradeLoading}
          disabled={isUpgradeLoading}
        >
          Upgrade to Growth
        </Button>
      )}
      {onManageSubscription && (
        <Button
          data-testid="manage-subscription-button"
          variant="outline"
          size="sm"
          onClick={onManageSubscription}
          loading={isManageLoading}
          disabled={isManageLoading}
        >
          Manage subscription
        </Button>
      )}
      {contactSalesUrl && (
        <Button
          asChild
          variant="outline"
          size="sm"
          colorPalette="orange"
          data-testid="contact-sales-button"
        >
          <Link unstyled href={contactSalesUrl} isExternal>
            Contact us to upgrade
          </Link>
        </Button>
      )}
    </HStack>
  );
}

export function CurrentPlanBlock({
  planName,
  pricing,
  features,
  eventUsage,
  userCount,
  maxSeats,
  upgradeRequired,
  onUserCountClick,
  onUpgrade,
  isUpgradeLoading,
  onManageSubscription,
  isManageLoading,
  deprecatedNotice,
  contactSalesUrl,
}: {
  planName: string;
  pricing?: {
    totalPrice: string;
    seatCount: number;
    perSeatPrice?: string | null;
  };
  features?: string[];
  eventUsage?: PlanEventUsage;
  userCount: number;
  maxSeats?: number;
  upgradeRequired?: boolean;
  onUserCountClick?: () => void;
  onUpgrade?: () => void;
  isUpgradeLoading?: boolean;
  onManageSubscription?: () => void;
  isManageLoading?: boolean;
  deprecatedNotice?: boolean;
  contactSalesUrl?: string;
}) {
  return (
    <Card
      data-testid="current-plan-block"
      title={planName}
      status="ok"
      description={
        pricing && (
          <PricingSummary
            totalPrice={pricing.totalPrice}
            seatCount={pricing.seatCount}
            perSeatPrice={pricing.perSeatPrice}
          />
        )
      }
      badge={
        <HStack gap={2}>
          <StatusChip label="Current" tone="good" />
          {upgradeRequired && <StatusChip label="Upgrade required" tone="warning" />}
        </HStack>
      }
      actions={
        <PlanActions
          onUpgrade={onUpgrade}
          isUpgradeLoading={isUpgradeLoading}
          onManageSubscription={onManageSubscription}
          isManageLoading={isManageLoading}
          contactSalesUrl={contactSalesUrl}
        />
      }
    >
      <VStack align="stretch" gap={4}>
        <SettingList>
          {eventUsage && <EventUsageRow usage={eventUsage} />}
          <SettingRow label="Members / seats">
            <Text textStyle="bodySm" fontWeight={600} fontVariantNumeric="tabular-nums">
              {maxSeats != null ? `${userCount} / ${maxSeats}` : userCount}
            </Text>
            {onUserCountClick && (
              <Button
                data-testid="user-count-link"
                variant="outline"
                size="xs"
                onClick={onUserCountClick}
              >
                Manage seats
              </Button>
            )}
          </SettingRow>
        </SettingList>
        {features && (
          <SimpleGrid
            data-testid="current-plan-features-grid"
            templateColumns={{ base: "1fr", md: "1fr 1.4fr 1fr" }}
            gap={2}
          >
            {features.map((feature) => (
              <HStack key={feature} gap={2} alignItems="start">
                <Box color="green.fg" flexShrink={0} paddingTop="0.5">
                  <Check size={16} />
                </Box>
                <Text fontSize="sm">{feature}</Text>
              </HStack>
            ))}
          </SimpleGrid>
        )}
        {deprecatedNotice && (
          <Banner status="info" data-testid="tiered-deprecated-notice">
            You are on a legacy tiered pricing model.{" "}
            <Link href="/settings/plans" color="orange.fg">
              Update your plan →
            </Link>{" "}
            to move to seat and usage billing.
          </Banner>
        )}
      </VStack>
    </Card>
  );
}
