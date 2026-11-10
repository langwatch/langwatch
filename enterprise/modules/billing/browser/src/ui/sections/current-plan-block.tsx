import { Link } from "@langwatch/browser-host/link";
/**
 * The active plan read like a bill: its price, this month's usage against its
 * limits, then the one action that moves it forward (upgrade, manage, or talk to sales).
 * @see specs/licensing/subscription-page.feature
 */
import { Banner } from "@langwatch/design-system/banner";
import { Card } from "@langwatch/design-system/card";
import { MeterBar } from "@langwatch/design-system/meter-bar";
import { Box, Button, HStack, SimpleGrid, Text, VStack } from "@langwatch/design-system/primitives";
import { SettingList, SettingRow, StatusChip } from "@langwatch/design-system/settings-card";
import { Check, Info } from "lucide-react";

import {
  type FixedSeats,
  fixedSeatsLine,
  type PlanEventUsage,
  type PlanPrice,
} from "../../model/subscription-page-state.ts";

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
          ? `New ${usage.noun} are not processed until the month resets or you upgrade.`
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
  return (
    <HStack gap={2} width="full" justify="flex-end" data-testid="current-plan-actions">
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

/** Seats fixed until renewal: what they cover and who changes them. */
function FixedSeatsLine({
  fixedSeats,
  contactUrl,
}: {
  fixedSeats: FixedSeats;
  contactUrl: string;
}) {
  return (
    <HStack gap={2} align="start" color="fg.muted" data-testid="fixed-seats-line">
      <Box flexShrink={0} paddingTop={1}>
        <Info size={14} />
      </Box>
      <Text textStyle="bodySm">
        {fixedSeatsLine(fixedSeats)}{" "}
        <Link href={contactUrl} isExternal color="orange.fg">
          Contact us
        </Link>
      </Text>
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
  isOverPlanSeats,
  onUserCountClick,
  onUpgrade,
  isUpgradeLoading,
  onManageSubscription,
  isManageLoading,
  deprecatedNotice,
  contactSalesUrl,
  fixedSeats,
  fixedSeatsContactUrl,
}: {
  planName: string;
  pricing?: PlanPrice;
  features?: string[];
  eventUsage?: PlanEventUsage;
  userCount: number;
  maxSeats?: number;
  upgradeRequired?: boolean;
  /** Above the plan's seats: the upgrade-required chip turns to the danger tone. */
  isOverPlanSeats?: boolean;
  onUserCountClick?: () => void;
  onUpgrade?: () => void;
  isUpgradeLoading?: boolean;
  onManageSubscription?: () => void;
  isManageLoading?: boolean;
  deprecatedNotice?: boolean;
  contactSalesUrl?: string;
  /** A contract or licence: the seats are shown with how to add more, never a seat control. */
  fixedSeats?: FixedSeats;
  fixedSeatsContactUrl?: string;
}) {
  // Fixed seats carry their own "Contact us" link, so the card has no second one.
  const salesUrl = fixedSeats ? undefined : contactSalesUrl;
  const isOverSeats = maxSeats != null && userCount > maxSeats;
  const hasActions = Boolean(onUpgrade || onManageSubscription || salesUrl);
  return (
    <Card
      data-testid="current-plan-block"
      title={
        <Box as="span" marginLeft="0.5" data-testid="current-plan-name">
          {planName}
        </Box>
      }
      status="ok"
      badgePlacement="title"
      footerDivider={hasActions}
      badge={
        <HStack gap={2}>
          <StatusChip label="Current" tone="good" />
          {upgradeRequired && (
            <StatusChip
              label="Upgrade required"
              tone={isOverPlanSeats || isOverSeats ? "bad" : "warning"}
              data-testid="upgrade-required-chip"
            />
          )}
        </HStack>
      }
      footer={
        hasActions ? (
          <PlanActions
            onUpgrade={onUpgrade}
            isUpgradeLoading={isUpgradeLoading}
            onManageSubscription={onManageSubscription}
            isManageLoading={isManageLoading}
            contactSalesUrl={salesUrl}
          />
        ) : undefined
      }
    >
      <VStack align="stretch" gap={4} paddingTop={2}>
        <SettingList variant="boxed" data-testid="plan-usage-rows">
          {pricing && (
            <SettingRow label="Price" data-testid="plan-price">
              <Text textStyle="bodySm" fontWeight={600} fontVariantNumeric="tabular-nums">
                {pricing.total}
                {pricing.note && (
                  <Text as="span" fontSize="xs" fontWeight="normal" color="fg.muted">
                    {` ${pricing.note}`}
                  </Text>
                )}
              </Text>
              {pricing.breakdown && (
                <Text textStyle="bodySm" color="fg.subtle" fontVariantNumeric="tabular-nums">
                  {pricing.breakdown}
                </Text>
              )}
            </SettingRow>
          )}
          {eventUsage && <EventUsageRow usage={eventUsage} />}
          <SettingRow label="Members / seats">
            <Text
              textStyle="bodySm"
              fontWeight={600}
              fontVariantNumeric="tabular-nums"
              color={isOverSeats ? "fg.error" : undefined}
              data-testid="plan-seat-count"
              data-over-limit={isOverSeats || undefined}
            >
              {maxSeats != null ? `${userCount} / ${maxSeats}` : userCount}
            </Text>
            {onUserCountClick && !fixedSeats && (
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
        {fixedSeats && fixedSeatsContactUrl && (
          <FixedSeatsLine fixedSeats={fixedSeats} contactUrl={fixedSeatsContactUrl} />
        )}
        {features && (
          <SimpleGrid
            data-testid="current-plan-features-grid"
            templateColumns={{ base: "1fr", md: "1fr 1.4fr 1fr" }}
            rowGap={2}
            columnGap={3}
          >
            {features.map((feature) => (
              <HStack key={feature} gap={2} alignItems="start" data-testid="current-plan-feature">
                <Box color="green.solid" flexShrink={0} paddingTop={1}>
                  <Check size={12} />
                </Box>
                <Text textStyle="bodySm" color="fg.muted">
                  {feature}
                </Text>
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
