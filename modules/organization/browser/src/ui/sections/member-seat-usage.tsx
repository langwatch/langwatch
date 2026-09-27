import { SimpleGrid } from "@chakra-ui/react";
import type { Plan as PlanInfo } from "@langwatch/entitlement-contract";

import { ResourceLimitRow } from "../../behavior/lent-resource-limit-row.tsx";
import { api } from "../../behavior/organization-api.ts";

/**
 * Where the organization stands on each kind of seat, on the page where seats are decided.
 * Spec: specs/licensing/seat-reconciliation.feature
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
    <SimpleGrid columns={{ base: 1, md: 2 }} gap={3} width="full" maxWidth="2xl">
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
    </SimpleGrid>
  );
}
