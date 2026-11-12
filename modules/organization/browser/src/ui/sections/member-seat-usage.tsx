import { SimpleGrid } from "@langwatch/design-system/primitives";
import type { Plan as PlanInfo } from "@langwatch/entitlement-contract";

import { ResourceLimitRow } from "../../behavior/lent-resource-limit-row.tsx";
import { api } from "../../behavior/organization-api.ts";
import { SEAT_TYPE_COPY } from "../../model/seat-type-copy.ts";

/**
 * Each kind of seat in use against the plan's cap. A plan with no Lite seats and none
 * taken (Free) shows no Lite card, not "0 / 0"; Developer seats always show, so a
 * Developer held over a cap of 0 reads as such.
 * Spec: specs/licensing/seat-reconciliation.feature, specs/members/developer-seat.feature
 */
export function MemberSeatUsage({
  organizationId,
  activePlan,
}: {
  organizationId: string;
  activePlan: PlanInfo;
}) {
  const usage = api.limits.getUsage.useQuery({ organizationId }, { refetchOnWindowFocus: false });

  if (!usage.data) return null;
  const showsLite = activePlan.maxMembersLite > 0 || usage.data.membersLiteCount > 0;

  return (
    <SimpleGrid
      columns={3}
      gap={{ base: 2, md: 3 }}
      width="full"
      maxWidth="2xl"
      data-testid="member-seat-usage"
    >
      <ResourceLimitRow
        limitType="members"
        current={usage.data.membersCount}
        max={activePlan.maxMembers}
      />
      {showsLite && (
        <ResourceLimitRow
          limitType="membersLite"
          current={usage.data.membersLiteCount}
          max={activePlan.maxMembersLite}
        />
      )}
      <ResourceLimitRow
        label={SEAT_TYPE_COPY.developerSeatsLabel}
        current={usage.data.membersDeveloperCount}
        max={activePlan.maxMembersDeveloper}
      />
    </SimpleGrid>
  );
}
