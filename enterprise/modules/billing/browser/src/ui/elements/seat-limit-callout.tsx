import { Link } from "@langwatch/browser-host/link";
import { Banner } from "@langwatch/design-system/banner";
import { Button } from "@langwatch/design-system/primitives";
import { CONTACT_SALES_URL } from "@langwatch/enterprise-licensing-contract";
import type { SeatLimitInfo } from "@langwatch/entitlement-contract";

/** What the over-seats organization can do about it, by plan. */
function SeatLimitAction({
  isUpgradePlanRequired,
  isEnterprisePlan,
  onAddSeats,
}: {
  isUpgradePlanRequired: boolean;
  isEnterprisePlan: boolean;
  onAddSeats: () => void;
}) {
  if (isUpgradePlanRequired) return <>Upgrade to the Growth plan below to keep everyone.</>;
  if (isEnterprisePlan) {
    return (
      <>
        <Link href={CONTACT_SALES_URL} textDecoration="underline">
          Contact sales
        </Link>{" "}
        to add seats.
      </>
    );
  }
  return (
    <>
      <Button
        variant="plain"
        size="sm"
        height="auto"
        padding={0}
        textDecoration="underline"
        onClick={onAddSeats}
      >
        Add seats
      </Button>{" "}
      to keep everyone.
    </>
  );
}

/**
 * Shown on the billing page when the organization uses more seats than its
 * plan includes, which a plan shrinking under a full organization leaves
 * behind. Everyone keeps access; the callout says what is over and what to do.
 */
export function SeatLimitCallout({
  seatLimitInfo,
  isUpgradePlanRequired,
  isEnterprisePlan,
  onAddSeats,
}: {
  seatLimitInfo: SeatLimitInfo | undefined;
  isUpgradePlanRequired: boolean;
  isEnterprisePlan: boolean;
  onAddSeats: () => void;
}) {
  if (seatLimitInfo?.status !== "exceeded") return null;

  return (
    <Banner
      status="warning"
      title="Your organization has more members than your plan includes"
      data-testid="seat-limit-callout"
    >
      {seatLimitInfo.message}{" "}
      <SeatLimitAction
        isUpgradePlanRequired={isUpgradePlanRequired}
        isEnterprisePlan={isEnterprisePlan}
        onAddSeats={onAddSeats}
      />
    </Banner>
  );
}
