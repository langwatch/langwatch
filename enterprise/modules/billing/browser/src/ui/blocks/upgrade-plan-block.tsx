import { AccessState } from "@langwatch/design-system/access-state";
/**
 * Upgrade Plan Block - displays upgrade CTA with features and dynamic pricing
 */
import { Button, VStack } from "@langwatch/design-system/primitives";
import type React from "react";

import { PlanFeatureList } from "../elements/plan-feature-list.tsx";
import { PricingSummary } from "../elements/pricing-summary.tsx";

export function UpgradePlanBlock({
  planName,
  totalPrice,
  coreMembers,
  features,
  monthlyEquivalent,
  onUpgrade,
  isLoading,
  isRequired = false,
  isSecondaryAction = false,
}: {
  planName: React.ReactNode;
  totalPrice: string;
  coreMembers: number;
  features: string[];
  monthlyEquivalent?: string | null;
  onUpgrade?: () => void;
  isLoading?: boolean;
  /** The organization uses more seats than its plan covers. */
  isRequired?: boolean;
  /** Another block on the page already carries the primary upgrade button. */
  isSecondaryAction?: boolean;
}) {
  return (
    <AccessState
      kind="upgrade"
      title={<>Upgrade to {planName}</>}
      description={
        isRequired
          ? "Your current plan doesn't cover these seats. Review the price below, then continue to checkout."
          : "Get more events, more seats and longer retention. Review the price below, then continue to checkout."
      }
      data-testid="upgrade-plan-block"
      actions={
        <Button
          colorPalette="orange"
          variant={isSecondaryAction ? "outline" : "solid"}
          data-emphasis={isSecondaryAction ? "secondary" : "primary"}
          size="sm"
          onClick={onUpgrade}
          loading={isLoading}
          disabled={isLoading}
        >
          Upgrade now
        </Button>
      }
    >
      <VStack align="stretch" gap={5}>
        <PricingSummary
          totalPrice={totalPrice}
          seatCount={coreMembers}
          perSeatPrice={monthlyEquivalent}
          totalTestId="upgrade-total"
        />
        <PlanFeatureList features={features} data-testid="upgrade-plan-features-grid" />
      </VStack>
    </AccessState>
  );
}
