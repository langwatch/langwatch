export abstract class CostAttributionPolicyRepository {
  abstract enabledCodingAssistantConfigs(organizationId: string): Promise<unknown[]>;
  /** The same configs for many organizations in one read; one without any is left out. */
  abstract findEnabledCodingAssistantConfigs(args: {
    organizationIds: readonly string[];
  }): Promise<{ organizationId: string; config: unknown }[]>;
  /** Every organization with at least one enabled coding-assistant tile (the billing backfill). */
  abstract organizationsWithEnabledCodingAssistants(): Promise<string[]>;
}
