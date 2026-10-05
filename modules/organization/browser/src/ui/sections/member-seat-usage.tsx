import { SimpleGrid } from "@langwatch/design-system/primitives";
import type { Plan as PlanInfo } from "@langwatch/entitlement-contract";

import { ResourceLimitRow } from "../../behavior/lent-resource-limit-row.tsx";
import { api } from "../../behavior/organization-api.ts";
import { SEAT_TYPE_COPY } from "../../model/seat-type-copy.ts";

/**
 * Where the organization stands on each kind of seat, on the page where seats are decided.
 * The Developer tile is counted with no limit beside it, because the plan does not meter it.
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

  return (
    <SimpleGrid columns={{ base: 1, md: 3 }} gap={3} width="full" maxWidth="2xl">
      <ResourceLimitRow
        limitType="members"
        current={usage.data.membersCount}
        max={activePlan.maxMembers}
      />
      <ResourceLimitRow
        limitType="membersLite"
        current={usage.data.membersLiteCount}
        max={activePlan.maxMembersLite}
      />
      <ResourceLimitRow
        label={SEAT_TYPE_COPY.developerSeatsLabel}
        current={usage.data.membersDeveloperCount}
      />
    </SimpleGrid>
  );
}
