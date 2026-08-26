import type { DataRetentionService } from "@langwatch/data-retention-contract";
import type { RetentionPolicy, RetentionPolicyResolver } from "@langwatch/eventing";

export class AppEventingRetentionAdapter implements RetentionPolicyResolver {
  static create(dataRetention: DataRetentionService): AppEventingRetentionAdapter {
    return new AppEventingRetentionAdapter(dataRetention);
  }

  private constructor(private readonly dataRetention: DataRetentionService) {}

  resolve(tenantId: string): Promise<RetentionPolicy> {
    return this.dataRetention.getResolvedForProject({ projectId: tenantId });
  }
}
