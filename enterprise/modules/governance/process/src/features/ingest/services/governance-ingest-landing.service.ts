// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import type { GovernanceIngestionSource } from "@langwatch/enterprise-governance-contract";

import type { GovernanceIngestReceiverMembers } from "./governance-ingest-receiver.service.ts";

/** Where a received batch lands: the organization's governance project, and the source's event stamp. */
export class GovernanceIngestLandingService {
  private constructor(
    private readonly members: Pick<GovernanceIngestReceiverMembers, "projects" | "sources">,
  ) {}

  static create(
    members: Pick<GovernanceIngestReceiverMembers, "projects" | "sources">,
  ): GovernanceIngestLandingService {
    return new GovernanceIngestLandingService(members);
  }

  async governanceTenantOf(source: GovernanceIngestionSource): Promise<string> {
    const project = await this.members.projects.ensureInternal({
      organizationId: source.organizationId,
      kind: "internal_governance",
    });

    return project.id;
  }

  recordEvent(source: GovernanceIngestionSource): Promise<unknown> {
    return this.members.sources.recordEventReceived(source.id);
  }
}
