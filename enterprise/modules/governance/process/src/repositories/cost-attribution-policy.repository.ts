export abstract class CostAttributionPolicyRepository {
  abstract enabledCodingAssistantConfigs(organizationId: string): Promise<unknown[]>;
  /** Every organization with at least one enabled coding-assistant tile (the billing backfill). */
  abstract organizationsWithEnabledCodingAssistants(): Promise<string[]>;
}
