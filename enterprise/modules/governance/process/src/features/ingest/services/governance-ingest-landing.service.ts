// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import type { GovernanceIngestionSource } from "@langwatch/enterprise-governance-contract";

import type { GovernanceIngestReceiverMembers } from "./governance-ingest-receiver.service.ts";

type LandingMembers = Pick<GovernanceIngestReceiverMembers, "projects" | "sources" | "allowance">;

/** Where a received batch lands: the organization's governance project, and the source's event stamp. */
export class GovernanceIngestLandingService {
  private constructor(private readonly members: LandingMembers) {}

  static create(members: LandingMembers): GovernanceIngestLandingService {
    return new GovernanceIngestLandingService(members);
  }

  /**
   * The governance project a batch lands in, once the monthly allowance the `/api/otel/v1/*`
   * receivers ask allows it: throws `ERR_PLAN_LIMIT` (402) for an organization past it.
   */
  async tenantWithinAllowance(source: GovernanceIngestionSource): Promise<string> {
    const project = await this.ensureProject(source);

    await this.members.allowance.otlpUsageLimit({
      project: { id: project.id, teamId: project.teamId, organizationId: source.organizationId },
      customerTraceIds: [],
    });

    return project.id;
  }

  recordEvent(source: GovernanceIngestionSource): Promise<unknown> {
    return this.members.sources.recordEventReceived(source);
  }

  private ensureProject(source: GovernanceIngestionSource) {
    return this.members.projects.ensureInternal({
      organizationId: source.organizationId,
      kind: "internal_governance",
    });
  }
}
