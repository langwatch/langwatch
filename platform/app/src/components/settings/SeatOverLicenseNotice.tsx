import { Box, Text } from "@chakra-ui/react";

import type { PlanInfo } from "../../../ee/licensing/planInfo";
import { api } from "../../utils/api";
import {
  nextSeatIsOverLicense,
  SEAT_OVER_LICENSE_INVITE_NOTICE,
} from "./seatOverage";

/**
 * What an admin is told before inviting a member into a seat their license
 * does not cover.
 *
 * A connected install may go over its licensed seats by the allowance its
 * lease carries, so the invitation is accepted, and the seat is invoiced at
 * the next quarterly true-up. Learning that from the invoice is worse than
 * reading it here.
 *
 * Nothing renders unless a lease applies and the next seat is over the
 * licensed count.
 *
 * Spec: specs/self-hosting/connected-services/license-sync.feature
 */
export function SeatOverLicenseNotice({
  organizationId,
  activePlan,
}: {
  organizationId: string;
  activePlan: PlanInfo | undefined;
}) {
  const usage = api.limits.getUsage.useQuery(
    { organizationId },
    { refetchOnWindowFocus: false },
  );

  if (!activePlan || !usage.data) return null;
  if (
    !nextSeatIsOverLicense({
      plan: activePlan,
      membersCount: usage.data.membersCount,
    })
  ) {
    return null;
  }

  return (
    <Box
      paddingX={4}
      paddingY={3}
      backgroundColor="orange.subtle"
      borderRadius="xl"
      width="100%"
      data-testid="seat-over-license-notice"
    >
      <Text fontSize="sm" color="fg">
        {SEAT_OVER_LICENSE_INVITE_NOTICE}
      </Text>
    </Box>
  );
}
