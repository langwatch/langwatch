/**
 * Current Plan Block - displays the active subscription
 */
import { Alert, Button, HStack, SimpleGrid, Text } from "@chakra-ui/react";
import { Link } from "@langwatch/browser-host/link";
import {
  SettingList,
  SettingRow,
  SettingsCard,
  StatusChip,
} from "@langwatch/design-system/settings-card";
import { Check } from "lucide-react";

import { PricingSummary } from "../../ui/elements/pricing-summary.tsx";

export function CurrentPlanBlock({
  planName,
  pricing,
  features,
  userCount,
  maxSeats,
  upgradeRequired,
  onUserCountClick,
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
  userCount: number;
  maxSeats?: number;
  upgradeRequired?: boolean;
  onUserCountClick?: () => void;
  onManageSubscription?: () => void;
  isManageLoading?: boolean;
  deprecatedNotice?: boolean;
  contactSalesUrl?: string;
}) {
  const hasActions = onManageSubscription || contactSalesUrl;
  return (
    <SettingsCard
      data-testid="current-plan-block"
      title={planName}
      tone="ok"
      hint={
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
        hasActions ? (
          <>
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
          </>
        ) : undefined
      }
    >
      <SettingList>
        <SettingRow label="Members / seats">
          <Text fontSize="13px" fontWeight={600} fontVariantNumeric="tabular-nums">
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
          color="fg.muted"
        >
          {features.map((feature) => (
            <HStack key={feature} gap={2} alignItems="start">
              <Check size={16} />
              <Text fontSize="sm">{feature}</Text>
            </HStack>
          ))}
        </SimpleGrid>
      )}
      {deprecatedNotice && (
        <Alert.Root status="info" data-testid="tiered-deprecated-notice">
          <Alert.Indicator />
          <Alert.Content>
            <Alert.Description>
              You are on a legacy tiered pricing model.{" "}
              <Link href="/settings/plans" color="orange.fg">
                Update your plan →
              </Link>{" "}
              to move to seat and usage billing.
            </Alert.Description>
          </Alert.Content>
        </Alert.Root>
      )}
    </SettingsCard>
  );
}
