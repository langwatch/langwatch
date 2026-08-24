export abstract class CostAttributionPolicyRepository {
  abstract enabledCodingAssistantConfigs(
    organizationId: string,
  ): Promise<unknown[]>;
}
