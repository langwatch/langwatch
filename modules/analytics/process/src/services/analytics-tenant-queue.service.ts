import { LangWatchQLTooManyMembersError } from "@langwatch/analytics-contract";
import {
  type Authorization,
  type ProofBearingPermission,
  projectIdsReadBy,
} from "@langwatch/authorization";
import type { TenantStatementLimiter } from "@langwatch/limiter";

/**
 * One read behind the share of every project it reads (ADR-177 v4.15), taken in one sorted
 * order so two reads never each hold what the other waits for. A read spanning more members
 * than the cap is refused before it queues.
 */
export class AnalyticsTenantQueueService {
  static create(deps: {
    tenantLimiter: TenantStatementLimiter;
    maxMembers: number;
  }): AnalyticsTenantQueueService {
    return new AnalyticsTenantQueueService(deps.tenantLimiter, deps.maxMembers);
  }

  private constructor(
    private readonly tenantLimiter: TenantStatementLimiter,
    private readonly maxMembers: number,
  ) {}

  run<T>({
    authorization,
    permission,
    projectId,
    task,
  }: {
    authorization: Authorization;
    permission: ProofBearingPermission;
    projectId: string;
    task: () => Promise<T>;
  }): Promise<T> {
    const tenants = projectIdsReadBy(authorization, permission);
    const memberCount = tenants.filter((tenantId) => tenantId !== projectId).length;
    if (memberCount > this.maxMembers) {
      return Promise.reject(
        new LangWatchQLTooManyMembersError({ memberCount, maxMembers: this.maxMembers }),
      );
    }
    const queued = tenants.reduceRight<() => Promise<T>>(
      (next, tenantId) => () => this.tenantLimiter.run({ tenantId, task: next }),
      task,
    );
    return queued();
  }
}
