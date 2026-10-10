import type { ProjectApi } from "@langwatch/project-contract";
import { nowInstant, Temporal, type Instant } from "@langwatch/time";

import type { TraceUsageCountRepository } from "../repositories/trace-usage-count.repository.ts";

/** Main's `TraceUsageService.getCountByProjects`: this UTC billing month's traces, per project. */
export class TraceUsageCountService {
  static create(deps: {
    projects: Pick<ProjectApi, "listIdsByOrganization">;
    usageCount: TraceUsageCountRepository;
    now?: () => Instant;
  }): TraceUsageCountService {
    return new TraceUsageCountService(deps.projects, deps.usageCount, deps.now ?? nowInstant);
  }

  private constructor(
    private readonly projects: Pick<ProjectApi, "listIdsByOrganization">,
    private readonly usageCount: TraceUsageCountRepository,
    private readonly now: () => Instant,
  ) {}

  async countByProjects({
    organizationId,
    projectIds,
  }: {
    organizationId: string;
    projectIds: string[];
  }): Promise<{ projectId: string; count: number }[]> {
    if (projectIds.length === 0) return [];

    // A foreign id must not read another tenant's trace counts.
    const owned = new Set(await this.projects.listIdsByOrganization({ organizationId }));
    const foreign = projectIds.filter((projectId) => !owned.has(projectId));
    if (foreign.length > 0) {
      throw new Error(
        `getCountByProjects: projectIds [${foreign.join(", ")}] do not belong to organization ${organizationId}`,
      );
    }

    const [startDate, endDate] = this.#billingMonthWindow();

    return Promise.all(
      projectIds.map(async (projectId) => ({
        projectId,
        count: await this.usageCount.countDistinctTraces({
          tenantId: projectId,
          startDate,
          endDate,
        }),
      })),
    );
  }

  /** The current UTC calendar month as a ClickHouse DateTime64(3) [start, end) window. */
  #billingMonthWindow(): [string, string] {
    const utc = this.now().toZonedDateTimeISO("UTC");
    const start = Temporal.PlainDate.from({ year: utc.year, month: utc.month, day: 1 });
    const end = start.add({ months: 1 });

    return [`${start.toString()} 00:00:00.000`, `${end.toString()} 00:00:00.000`];
  }
}
