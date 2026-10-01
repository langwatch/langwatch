// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * The Activity Monitor reads the CLI performs, each with the ownership proof
 * that belongs to it: a valid bearer must not be able to walk source ids
 * belonging to another tenant, even though the reads also filter by
 * organization.
 */
import type {
  ActivityEventDetailRow,
  GovernanceIngestionSource,
  SourceHealthMetrics,
} from "@langwatch/enterprise-governance-contract";

import type { ActivityMonitorService } from "./ingestion-source-activity.service.ts";
import type { IngestionSourceService } from "./ingestion-source.service.ts";

/** One source as the CLI's Activity Monitor lists it. */
export type GovernanceCliSourceSummary = Readonly<{
  id: string;
  name: string;
  status: string;
}>;

export type GovernanceCliSourceHealth = Readonly<{
  source: GovernanceCliSourceSummary;
  health: SourceHealthMetrics;
}>;

/** What the CLI governance transport reads out of the Activity Monitor. */
export interface GovernanceCliActivityApi {
  sources: (input: {
    organizationId: string;
    includeArchived: boolean;
  }) => Promise<readonly GovernanceIngestionSource[]>;
  eventsForSource(input: {
    organizationId: string;
    sourceId: string;
    limit: number;
    beforeIso: string | undefined;
  }): Promise<ActivityEventDetailRow[]>;
  healthForSource(input: {
    organizationId: string;
    sourceId: string;
  }): Promise<GovernanceCliSourceHealth>;
}

/** The SAME services the console's Activity Monitor reads. */
export type GovernanceCliActivityMembers = Readonly<{
  sources: Pick<IngestionSourceService, "list" | "getById">;
  activity: Pick<ActivityMonitorService, "eventsForSource" | "sourceHealthMetrics">;
}>;

export class GovernanceCliActivityService implements GovernanceCliActivityApi {
  private constructor(private readonly members: GovernanceCliActivityMembers) {}

  static create(members: GovernanceCliActivityMembers): GovernanceCliActivityService {
    return new GovernanceCliActivityService(members);
  }

  /** Archived sources are excluded unless the caller explicitly asked for them. */
  async sources(input: {
    organizationId: string;
    includeArchived: boolean;
  }): Promise<readonly GovernanceIngestionSource[]> {
    const sources = await this.members.sources.list(input.organizationId);

    return input.includeArchived ? sources : sources.filter((source) => source.archivedAt === null);
  }

  async eventsForSource(input: {
    organizationId: string;
    sourceId: string;
    limit: number;
    beforeIso: string | undefined;
  }): Promise<ActivityEventDetailRow[]> {
    // Ownership is proved before the analytics read.
    await this.members.sources.getById({
      id: input.sourceId,
      organizationId: input.organizationId,
    });

    return this.members.activity.eventsForSource({
      organizationId: input.organizationId,
      sourceId: input.sourceId,
      limit: input.limit,
      beforeIso: input.beforeIso,
    });
  }

  async healthForSource(input: {
    organizationId: string;
    sourceId: string;
  }): Promise<GovernanceCliSourceHealth> {
    const source = await this.members.sources.getById({
      id: input.sourceId,
      organizationId: input.organizationId,
    });
    const health = await this.members.activity.sourceHealthMetrics({
      organizationId: input.organizationId,
      sourceId: input.sourceId,
    });

    return { source: { id: source.id, name: source.name, status: source.status }, health };
  }
}
