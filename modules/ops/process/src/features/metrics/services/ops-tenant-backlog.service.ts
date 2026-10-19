import type { FeatureFlagApi } from "@langwatch/feature-flag-contract";
import type { QueueInfo } from "@langwatch/ops-contract";

import type { AnomalyRateTrackerRepository } from "../../../repositories/anomaly.repository.ts";
import { ANOMALY_DETECTION_KILL_SWITCH_FLAG } from "../../../rules/anomaly-constants.rules.ts";
import { countWaitingJobsByTenant } from "../../../rules/ops-tenant-backlog.rules.ts";

interface OpsTenantBacklogOptions {
  rateTracker: AnomalyRateTrackerRepository;
  featureFlags: Pick<FeatureFlagApi, "isEnabled"> | undefined;
}

/** Each tenant's waiting jobs per metrics cycle, as anomaly detection reads them. */
export class OpsTenantBacklogService {
  static create(options: OpsTenantBacklogOptions): OpsTenantBacklogService {
    return new OpsTenantBacklogService(options);
  }

  private constructor(private readonly options: OpsTenantBacklogOptions) {}

  /**
   * What anomaly detection reads: each tenant's waiting jobs as this cycle saw them, recorded once
   * across the fleet because only the lease holder scans. Main counted at enqueue instead; the
   * difference is in specs/event-queue-anomaly-detection.feature.
   */
  async record(queues: QueueInfo[]): Promise<void> {
    const backlogs = countWaitingJobsByTenant({ queues });
    await Promise.all(
      [...backlogs].map(async ([tenantId, count]) => {
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
