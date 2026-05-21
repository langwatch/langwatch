import type { ClickHouseClient } from "@clickhouse/client";
import type { PinnedTrace } from "@prisma/client";
import type { ClickHouseClientResolver } from "~/server/clickhouse/clickhouseClient";
import { createLogger } from "~/utils/logger/server";
import type { RetentionPolicyCache } from "../retentionPolicyCache";
import type { PinnedTraceRepository } from "./pinnedTrace.repository";

const logger = createLogger("langwatch:data-retention:pinning");

const TRACE_TABLES = [
  "stored_spans",
  "stored_log_records",
  "stored_metric_records",
  "trace_summaries",
  "evaluation_runs",
  "event_log",
] as const;

interface PinTraceParams {
  projectId: string;
  traceId: string;
  userId?: string | null;
  reason?: string | null;
}

interface UnpinTraceParams {
  projectId: string;
  traceId: string;
}

export class PinnedTraceService {
  constructor(
    private readonly repository: PinnedTraceRepository,
    private readonly resolveClickHouseClient: ClickHouseClientResolver | null,
    private readonly retentionPolicyCache: RetentionPolicyCache,
  ) {}

  async pin(params: PinTraceParams): Promise<PinnedTrace> {
    const pin = await this.repository.create({
      ...params,
      source: "manual",
    });

    await this.updateClickHouseRetention({
      projectId: params.projectId,
      traceIds: [params.traceId],
      retentionDays: 0,
    });

    return pin;
  }

  async unpin(params: UnpinTraceParams): Promise<void> {
    await this.repository.delete(params);

    const retentionDays = await this.retentionPolicyCache.getRetentionDays(
      params.projectId,
      "traces",
    );

    await this.updateClickHouseRetention({
      projectId: params.projectId,
      traceIds: [params.traceId],
      retentionDays,
    });
  }

  async autoPin({
    projectId,
    traceId,
  }: {
    projectId: string;
    traceId: string;
  }): Promise<PinnedTrace> {
    const pin = await this.repository.create({
      projectId,
      traceId,
      source: "share",
    });

    await this.updateClickHouseRetention({
      projectId,
      traceIds: [traceId],
      retentionDays: 0,
    });

    return pin;
  }

  async autoUnpin({
    projectId,
    traceId,
  }: {
    projectId: string;
    traceId: string;
  }): Promise<void> {
    const hasManual = await this.repository.hasManualPin({
      projectId,
      traceId,
    });
    if (hasManual) return;

    await this.repository.delete({ projectId, traceId });

    const retentionDays = await this.retentionPolicyCache.getRetentionDays(
      projectId,
      "traces",
    );

    await this.updateClickHouseRetention({
      projectId,
      traceIds: [traceId],
      retentionDays,
    });
  }

  async isPinned({
    projectId,
    traceId,
  }: {
    projectId: string;
    traceId: string;
  }): Promise<boolean> {
    const pin = await this.repository.findByProjectAndTrace({
      projectId,
      traceId,
    });
    return pin != null;
  }

  async getPin({
    projectId,
    traceId,
  }: {
    projectId: string;
    traceId: string;
  }): Promise<PinnedTrace | null> {
    return this.repository.findByProjectAndTrace({ projectId, traceId });
  }

  async listByProject({
    projectId,
  }: {
    projectId: string;
  }): Promise<PinnedTrace[]> {
    return this.repository.findAllByProject({ projectId });
  }

  async getPinnedTraceIds({
    projectId,
  }: {
    projectId: string;
  }): Promise<string[]> {
    return this.repository.findAllTraceIds({ projectId });
  }

  private async updateClickHouseRetention({
    projectId,
    traceIds,
    retentionDays,
  }: {
    projectId: string;
    traceIds: string[];
    retentionDays: number;
  }): Promise<void> {
    if (!this.resolveClickHouseClient || traceIds.length === 0) return;

    let client: ClickHouseClient;
    try {
      client = await this.resolveClickHouseClient(projectId);
    } catch {
      logger.warn({ projectId }, "ClickHouse not available for pin mutation");
      return;
    }

    const esc = (s: string) => s.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
    const traceIdList = traceIds.map((id) => `'${esc(id)}'`).join(",");
    const escapedProjectId = esc(projectId);

    for (const table of TRACE_TABLES) {
      try {
        await client.command({
          query: `ALTER TABLE ${table} UPDATE _retention_days = ${retentionDays} WHERE TenantId = '${escapedProjectId}' AND TraceId IN (${traceIdList}) AND _retention_days != ${retentionDays}`,
        });
      } catch (error) {
        logger.error(
          { projectId, table, error },
          "Failed to update _retention_days for pinned trace",
        );
      }
    }
  }
}
