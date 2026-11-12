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

  async governanceTenantOf(source: GovernanceIngestionSource): Promise<string> {
    const project = await this.ensureProject(source);

    return project.id;
  }

  /**
   * The monthly allowance the `/api/otel/v1/*` receivers ask, asked of the governance project:
   * throws `ERR_PLAN_LIMIT` (402) for an organization past it, so no door is the way around it.
   */
  async assertWithinAllowance(source: GovernanceIngestionSource): Promise<void> {
    const project = await this.ensureProject(source);

    await this.members.allowance.otlpUsageLimit({
      project: { id: project.id, teamId: project.teamId, organizationId: source.organizationId },
      customerTraceIds: [],
    });
  }

  recordEvent(source: GovernanceIngestionSource): Promise<unknown> {
    return this.members.sources.recordEventReceived(source.id);
  }

  private ensureProject(source: GovernanceIngestionSource) {
    return this.members.projects.ensureInternal({
      organizationId: source.organizationId,
      kind: "internal_governance",
    });
  }
}
