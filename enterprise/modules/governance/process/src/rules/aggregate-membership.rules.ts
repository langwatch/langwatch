// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/** What one reconcile of an aggregate writes: members to attach, reads to revoke, the rest. */
type AggregateMembershipDecision = {
  attach: string[];
  revoke: string[];
  unchanged: string[];
};

/**
 * ADR-177 decision 3: the members an aggregate's rule selects against the members it reads now.
 * The aggregate is never its own member; each list is sorted, so a second run decides nothing new.
 */
export function decideAggregateMembership({
  aggregateProjectId,
  desired,
  held,
}: {
  aggregateProjectId: string;
  desired: readonly string[];
  held: readonly string[];
}): AggregateMembershipDecision {
  const wanted = new Set(desired.filter((id) => id !== aggregateProjectId));
  const holding = new Set(held);
  return {
    attach: [...wanted].filter((id) => !holding.has(id)).toSorted(),
    revoke: [...holding].filter((id) => !wanted.has(id)).toSorted(),
    unchanged: [...holding].filter((id) => wanted.has(id)).toSorted(),
  };
}
