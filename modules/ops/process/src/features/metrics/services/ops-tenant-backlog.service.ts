import type { FeatureFlagApi } from "@langwatch/feature-flag-contract";
import type { QueueInfo } from "@langwatch/ops-contract";

import type { AnomalyRateTrackerRepository } from "../../../repositories/anomaly.repository.ts";
import { ANOMALY_DETECTION_KILL_SWITCH_FLAG } from "../../../rules/anomaly-constants.rules.ts";
import {
  countArrivalsByTenant,
  countWaitingJobsByTenant,
} from "../../../rules/ops-tenant-backlog.rules.ts";

interface OpsTenantBacklogOptions {
  rateTracker: AnomalyRateTrackerRepository;
  featureFlags: Pick<FeatureFlagApi, "isEnabled"> | undefined;
}

/** Each tenant's job arrivals between metrics cycles, as anomaly detection reads them. */
export class OpsTenantBacklogService {
  static create(options: OpsTenantBacklogOptions): OpsTenantBacklogService {
    return new OpsTenantBacklogService(options);
  }

  /** The previous scan's waiting jobs per tenant; null until this pod has scanned once. */
  private previousBacklogs: ReadonlyMap<string, number> | null = null;

  private constructor(private readonly options: OpsTenantBacklogOptions) {}

  /**
   * Records each tenant's arrivals since the last scan, once across the fleet because only the
   * lease holder scans. The first scan only sets the baseline. Main counted at enqueue; the
   * difference is in specs/event-queue-anomaly-detection.feature.
   */
  async record(queues: QueueInfo[]): Promise<void> {
    const backlogs = countWaitingJobsByTenant({ queues });
    const previous = this.previousBacklogs;
    this.previousBacklogs = backlogs;
    if (!previous) return;

    const arrivals = countArrivalsByTenant({ previous, current: backlogs });
    await Promise.all(
      [...arrivals].map(async ([tenantId, count]) => {
        if (await this.isKilledForTenant(tenantId)) return;
        await this.options.rateTracker.record(tenantId, count);
      }),
    );
  }

  /** The detector's per-tenant kill switch; a failed lookup counts the tenant. */
  private async isKilledForTenant(tenantId: string): Promise<boolean> {
    if (!this.options.featureFlags || !tenantId) return false;
    try {
      return await this.options.featureFlags.isEnabled(ANOMALY_DETECTION_KILL_SWITCH_FLAG, {
        kind: "project",
        projectId: tenantId,
      });
    } catch {
      return false;
    }
  }
}
