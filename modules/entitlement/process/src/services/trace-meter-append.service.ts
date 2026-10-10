import type { AppendStore } from "@langwatch/eventing";
import { createLogger, type Logger } from "@langwatch/observability";

import type { TenancyRepository } from "../repositories/tenancy.repository.ts";
import type {
  TraceMeterRecord,
  TraceMeterRepository,
} from "../repositories/trace-meter.repository.ts";

const defaultLogger = createLogger("langwatch:usage:traceMeter");

/** The trace meter's append side. A failed insert throws so the queue redelivers. */
export class TraceMeterAppendService implements AppendStore<TraceMeterRecord> {
  private constructor(
    private readonly meter: TraceMeterRepository,
    private readonly projects: Pick<TenancyRepository, "getProjectPlacement">,
    private readonly logger: Pick<Logger, "warn">,
  ) {}

  static create({
    meter,
    projects,
    logger = defaultLogger,
  }: {
    meter: TraceMeterRepository;
    projects: Pick<TenancyRepository, "getProjectPlacement">;
    logger?: Pick<Logger, "warn">;
  }): TraceMeterAppendService {
    return new TraceMeterAppendService(meter, projects, logger);
  }

  /** An orphan project is skipped loudly, and the miss is not remembered. */
  async append(record: TraceMeterRecord): Promise<void> {
    await this.appendProject({ projectId: record.tenantId, records: [record] });
  }

  /** Replay's write: one placement lookup and one insert per project in the batch. */
  async bulkAppend(records: TraceMeterRecord[]): Promise<void> {
    const byProject = new Map<string, TraceMeterRecord[]>();
    for (const record of records) {
      byProject.set(record.tenantId, [...(byProject.get(record.tenantId) ?? []), record]);
    }
    for (const [projectId, projectRecords] of byProject) {
      await this.appendProject({ projectId, records: projectRecords });
    }
  }

  private async appendProject({
    projectId,
    records,
  }: {
    projectId: string;
    records: readonly TraceMeterRecord[];
  }): Promise<void> {
    const placement = await this.projects.getProjectPlacement({ projectId });
    if (placement.kind === "unplaced") {
      this.logger.warn({ projectId }, "orphan project has no organization, trace not metered");
      return;
    }
    await this.meter.insert({ records, organizationId: placement.organizationId });
  }
}
