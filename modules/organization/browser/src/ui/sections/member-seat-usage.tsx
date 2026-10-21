import { SimpleGrid } from "@langwatch/design-system/primitives";
import { ResourceLimitRow } from "@langwatch/enterprise-licensing-client";
import type { Plan as PlanInfo } from "@langwatch/entitlement-contract";

import { api } from "../../behavior/organization-api.ts";
import { SEAT_TYPE_COPY } from "../../model/seat-type-copy.ts";

/**
 * Each kind of seat in use, as one row of three at every width. Developer seats
 * (ADR-171) are counted with no limit: the plan does not meter them.
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
