import { SimpleGrid } from "@chakra-ui/react";

import type { PlanInfo } from "../../../ee/licensing/planInfo";
import { LIMIT_TYPE_DISPLAY_LABELS } from "../../server/license-enforcement/constants";
import { api } from "../../utils/api";
import { ResourceLimitRow } from "../license/ResourceLimitRow";

/**
 * Where the organization stands on each kind of seat, on the page where seats
 * are decided.
 *
 * The two decisions the member list offers, moving somebody to a Lite Member
 * seat and disabling them, are each refused once the matching allowance runs
 * out. Without this an admin reconciling down to their plan learns the
 * allowances one refusal at a time, having already picked the person and clicked
 * save. Same counts and the same row component as the usage page, so the two
 * never disagree.
 *
 * Spec: specs/licensing/seat-reconciliation.feature
 */
export function MemberSeatUsage({
  organizationId,
  activePlan,
}: {
  organizationId: string;
  activePlan: PlanInfo;
}) {
  const usage = api.limits.getUsage.useQuery(
    { organizationId },
    { refetchOnWindowFocus: false },
  );

  if (!usage.data) return null;

  return (
    <SimpleGrid
      columns={{ base: 1, md: 2 }}
      gap={3}
      width="full"
      maxWidth="2xl"
    >
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
