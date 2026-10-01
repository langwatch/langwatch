// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import type {
  GovernanceIngestionSource,
  IngestionSourceDto,
} from "@langwatch/enterprise-governance-contract";
import { createTenantId } from "@langwatch/eventing";
import { PROJECT_KIND, type ProjectApi } from "@langwatch/project-contract";

import type { IngestionPullRunRepository } from "../repositories/ingestion-pull-run.repository.ts";
import { type PullRunSummary, sourcePullStatus } from "../rules/source-pull-status.rules.ts";
import { IngestionSourceService } from "./ingestion-source.service.ts";

/**
 * The admin surface's view of a source (main `ingestionSources.ts` toIngestionSourceDto): the
 * secret hash, rotation slot and credentials envelope never travel.
 */
export class IngestionSourceReadService {
  private constructor(
    private readonly sources: IngestionSourceService,
    private readonly pullRuns: IngestionPullRunRepository,
    private readonly projects: Pick<ProjectApi, "findInternal">,
  ) {}

  static create({
    sources,
    pullRuns,
    projects,
  }: {
    sources: IngestionSourceService;
    pullRuns: IngestionPullRunRepository;
    projects: Pick<ProjectApi, "findInternal">;
  }): IngestionSourceReadService {
    return new IngestionSourceReadService(sources, pullRuns, projects);
  }

  async list(organizationId: string): Promise<IngestionSourceDto[]> {
    const rows = await this.sources.list(organizationId);
    const live = await this.sources.liveTraceProjectIds(rows, organizationId);
    return rows.map((row) => this.toDto({ row, live, pullRun: null }));
  }

  async get(input: { id: string; organizationId: string }): Promise<IngestionSourceDto> {
    const row = await this.sources.getById(input);
    const pullRun = row.pullSchedule ? await this.lastPullRun(input) : null;
    const live = await this.sources.liveTraceProjectIds([row], input.organizationId);
    return this.toDto({ row, live, pullRun });
  }

  async present(row: GovernanceIngestionSource): Promise<IngestionSourceDto> {
    const live = await this.sources.liveTraceProjectIds([row], row.organizationId);
    return this.toDto({ row, live, pullRun: null });
  }

  private async lastPullRun({
    id,
    organizationId,
  }: {
    id: string;
    organizationId: string;
  }): Promise<PullRunSummary | null> {
    const project = await this.projects.findInternal({
      organizationId,
      kind: PROJECT_KIND.INTERNAL_GOVERNANCE,
    });
    if (!project) return null;
    const read = await this.pullRuns.get(id, {
      tenantId: createTenantId(project.id),
      aggregateId: id,
    });
    return read.kind === "folded" ? read.projection.state : null;
  }

  private toDto({
    row,
    live,
    pullRun,
  }: {
    row: GovernanceIngestionSource;
    live: ReadonlySet<string>;
    pullRun: PullRunSummary | null;
  }): IngestionSourceDto {
    const traceProjectId = row.traceProjectId ?? null;
    return {
      id: row.id,
      organizationId: row.organizationId,
      teamId: row.teamId,
      sourceType: row.sourceType,
      name: row.name,
      description: row.description,
      parserConfig: Object.fromEntries(
        Object.entries(row.parserConfig).filter(
          ([key]) => !key.startsWith("_") && key !== "credentials",
        ),
      ),
      hasPollerCursor: IngestionSourceService.hasPollerCursor(row.pollerCursor),
      pullSchedule: row.pullSchedule,
      status: row.status,
      errorCount: row.errorCount,
      lastSuccessAt: row.lastSuccessAt ?? null,
      lastReadThroughAt: row.lastReadThroughAt ?? null,
      lastRunCompleteness: row.lastRunCompleteness ?? null,
      pullStatus: sourcePullStatus({
        sourceType: row.sourceType,
        cursor: row.pollerCursor,
        pullRun,
      }),
      traceProjectId,
      traceProjectArchived: traceProjectId ? !live.has(traceProjectId) : false,
      lastEventAt: row.lastEventAt,
      archivedAt: row.archivedAt,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      createdById: row.createdById,
    };
  }
}
