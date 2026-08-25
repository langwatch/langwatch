import { CostAttributionPolicyRepository } from "../cost-attribution-policy.repository";

type CostAttributionPrismaClient = {
  aiToolEntry: {
    findMany(input: {
      where: {
        organizationId: string;
        type: "coding_assistant";
        enabled: true;
        archivedAt: null;
      };
      select: { config: true };
    }): Promise<Array<{ config: unknown }>>;
  };
};

export class PrismaCostAttributionPolicyRepository extends CostAttributionPolicyRepository {
  private constructor(private readonly client: CostAttributionPrismaClient) {
    super();
  }

  static create(client: unknown): PrismaCostAttributionPolicyRepository {
    return new PrismaCostAttributionPolicyRepository(
      client as CostAttributionPrismaClient,
    );
  }

  async enabledCodingAssistantConfigs(organizationId: string): Promise<unknown[]> {
    const rows = await this.client.aiToolEntry.findMany({
      where: {
        organizationId,
        type: "coding_assistant",
        enabled: true,
        archivedAt: null,
      },
      select: { config: true },
    });
    return rows.map((row) => row.config);
  }
}
