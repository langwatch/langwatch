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

/** Matches the app banner's line for an over-plan organization (seat-limit-banner.tsx). */
const HELD_TRACES_LINE =
  "New traces are saved and will show once you upgrade your plan or remove members.";

/**
 * Shown on the billing page when the organization uses more seats than its plan includes,
 * which a plan shrinking under a full organization leaves behind. It says what is over,
 * what to do and, while over plan, that new traces are held.
 */
export function SeatLimitCallout({
  seatLimitInfo,
  isUpgradePlanRequired,
  isEnterprisePlan,
  onAddSeats,
  isOverPlan = false,
  isPaymentRecoveryOpen = false,
}: {
  seatLimitInfo: SeatLimitInfo | undefined;
  isUpgradePlanRequired: boolean;
  isEnterprisePlan: boolean;
  onAddSeats: () => void;
  /** Over plan (specs/billing/over-plan-trace-withholding.feature): new traces are withheld. */
  isOverPlan?: boolean;
  /** An unpaid invoice: paying it, not a new upgrade, brings the plan back. */
  isPaymentRecoveryOpen?: boolean;
}) {
  if (seatLimitInfo?.status !== "exceeded") return null;

  return (
    <Banner
      status="warning"
      title="Your organization has more members than your plan includes"
      data-testid="seat-limit-callout"
    >
      {seatLimitInfo.message}{" "}
      {isPaymentRecoveryOpen ? (
        "Pay the open invoice to get your plan back."
      ) : (
        <SeatLimitAction
          isUpgradePlanRequired={isUpgradePlanRequired}
          isEnterprisePlan={isEnterprisePlan}
          onAddSeats={onAddSeats}
        />
      )}
      {isOverPlan && ` ${HELD_TRACES_LINE}`}
    </Banner>
  );
}
