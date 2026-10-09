// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import type { AuthzAggregateReadEventData } from "@langwatch/authz-contract";

import type { GovernanceModule } from "../app/governance.app.ts";

export type AggregateReadViews = Pick<GovernanceModule, "governanceAuditWorkspaceView">;

type AggregateReadFact = Pick<
  AuthzAggregateReadEventData,
  "organizationId" | "actorUserId" | "aggregateProjectId" | "occurredAt"
>;

/**
 * authz's aggregate-read fact, landed as the admin workspace view row of kind aggregate (§9).
 * The fact's time is the window's clock, so a redelivered fact writes nothing.
 * Spec: specs/governance/aggregate-project.feature, section G
 */
export function auditAggregateRead({
  views,
}: {
  views: AggregateReadViews;
}): (fact: AggregateReadFact) => Promise<void> {
  return async ({ organizationId, actorUserId, aggregateProjectId, occurredAt }) => {
    await views.governanceAuditWorkspaceView({
      view: { kind: "aggregate", organizationId, actorUserId, targetProjectId: aggregateProjectId },
      occurredAt,
    });
  };
}
