import { Link } from "@langwatch/browser-host/link";
import { Box, Button, HStack, Text, VStack } from "@langwatch/design-system/primitives";
import { CONTACT_SALES_URL } from "@langwatch/enterprise-licensing-contract";
import type { SeatLimitInfo } from "@langwatch/entitlement-contract";
import { Users } from "lucide-react";

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
    <Box
      data-testid="seat-limit-callout"
      borderWidth="1px"
      borderColor="orange.muted"
      backgroundColor="orange.subtle"
      borderRadius="lg"
      padding={5}
      width="full"
    >
      <HStack align="start" gap={4}>
        <Box color="orange.fg" paddingTop={1}>
          <Users size={20} />
        </Box>
        <VStack align="start" gap={1} flex={1}>
          <Text fontWeight="medium">
            Your organization has more members than your plan includes
          </Text>
          <Text color="fg.muted" fontSize="sm">
            {seatLimitInfo.message}{" "}
            <SeatLimitAction
              isUpgradePlanRequired={isUpgradePlanRequired}
              isEnterprisePlan={isEnterprisePlan}
              onAddSeats={onAddSeats}
            />
          </Text>
        </VStack>
      </HStack>
    </Box>
  );
}
