import type { DataRetentionApi } from "@langwatch/data-retention-contract";
import type { RetentionPolicy, RetentionPolicyResolver } from "@langwatch/eventing";

/**
 * The retention a replay stamps on the rows it rebuilds, as main's replay read the policy cache:
 * a tenant is a project, and data retention answers its cascade, or the platform default for a
 * project it cannot place. A refusal is not defaulted: the run fails rather than guess.
 */
export class ReplayRetentionService implements RetentionPolicyResolver {
  static create(
    retention: Pick<DataRetentionApi, "getResolvedForProject">,
  ): ReplayRetentionService {
    return new ReplayRetentionService(retention);
  }

  private constructor(
    private readonly retention: Pick<DataRetentionApi, "getResolvedForProject">,
  ) {}

  readonly resolve = (tenantId: string): Promise<RetentionPolicy> =>
    this.retention.getResolvedForProject({ projectId: tenantId });
}
