import type { AppendStore } from "@langwatch/eventing";
import { createLogger, type Logger } from "@langwatch/observability";

import type {
  BillableEventRecord,
  BillableEventsMeterRepository,
} from "../repositories/billable-events-meter.repository.ts";
import type { TenancyRepository } from "../repositories/tenancy.repository.ts";

const defaultLogger = createLogger("langwatch:usage:meter");

/** The meter's append side. A failed insert throws so the queue redelivers. */
export class BillableEventsMeterAppendService implements AppendStore<BillableEventRecord> {
  private constructor(
    private readonly meter: BillableEventsMeterRepository,
    private readonly projects: Pick<TenancyRepository, "getProjectPlacement">,
    private readonly logger: Pick<Logger, "warn">,
  ) {}

  static create({
    meter,
    projects,
    logger = defaultLogger,
  }: {
    meter: BillableEventsMeterRepository;
    projects: Pick<TenancyRepository, "getProjectPlacement">;
    logger?: Pick<Logger, "warn">;
  }): BillableEventsMeterAppendService {
    return new BillableEventsMeterAppendService(meter, projects, logger);
  }

  /** An orphan project is skipped loudly, and the miss is not remembered. */
  async append(record: BillableEventRecord): Promise<void> {
    const placement = await this.projects.getProjectPlacement({ projectId: record.tenantId });
    if (placement.kind === "unplaced") {
      this.logger.warn(
        { projectId: record.tenantId },
        "orphan project has no organization, not metered",
      );
      return;
    }
    await this.meter.insert({ record, organizationId: placement.organizationId });
  }
}
