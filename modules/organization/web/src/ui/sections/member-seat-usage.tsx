import { SimpleGrid } from "@chakra-ui/react";

import type { Plan as PlanInfo } from "@langwatch/entitlement-contract";
import {
  LIMIT_TYPE_DISPLAY_LABELS,
  ResourceLimitRow,
} from "@langwatch/enterprise-licensing-web/surfaces/resource-limits";
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
        label={LIMIT_TYPE_DISPLAY_LABELS.members}
        current={usage.data.membersCount}
        max={activePlan.maxMembers}
      />
      <ResourceLimitRow
        label={LIMIT_TYPE_DISPLAY_LABELS.membersLite}
        current={usage.data.membersLiteCount}
        max={activePlan.maxMembersLite}
      />
    </SimpleGrid>
  );
}
