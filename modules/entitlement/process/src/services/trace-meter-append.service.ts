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
    const placement = await this.projects.getProjectPlacement({ projectId: record.tenantId });
    if (placement.kind === "unplaced") {
      this.logger.warn(
        { projectId: record.tenantId },
        "orphan project has no organization, trace not metered",
      );
      return;
    }
    await this.meter.insert({ record, organizationId: placement.organizationId });
  }
}
