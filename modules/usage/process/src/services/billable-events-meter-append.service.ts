import type { AppendStore } from "@langwatch/eventing";
import { createLogger } from "@langwatch/observability";
import type { ProjectApi } from "@langwatch/project-contract";

import type {
  BillableEventRecord,
  BillableEventsMeterRepository,
} from "../repositories/billable-events-meter.repository.ts";

const logger = createLogger("langwatch:usage:meter");

/** The meter's append side. A failed insert throws so the queue redelivers. */
export class BillableEventsMeterAppendService implements AppendStore<BillableEventRecord> {
  private constructor(
    private readonly meter: BillableEventsMeterRepository,
    private readonly projects: Pick<ProjectApi, "findOrganizationId">,
  ) {}

  static create({
    meter,
    projects,
  }: {
    meter: BillableEventsMeterRepository;
    projects: Pick<ProjectApi, "findOrganizationId">;
  }): BillableEventsMeterAppendService {
    return new BillableEventsMeterAppendService(meter, projects);
  }

  /** An orphan project is skipped loudly, and the miss is not remembered. */
  async append(record: BillableEventRecord): Promise<void> {
    const organizationId = await this.projects.findOrganizationId(record.tenantId);
    if (!organizationId) {
      logger.warn(
        { projectId: record.tenantId },
        "orphan project has no organization, not metered",
      );
      return;
    }
    await this.meter.insert({ record, organizationId });
  }
}
