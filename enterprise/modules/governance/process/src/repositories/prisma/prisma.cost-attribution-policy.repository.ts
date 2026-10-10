import { CostAttributionPolicyRepository } from "../cost-attribution-policy.repository.ts";

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
    }): Promise<{ config: unknown }[]>;
    findMany(input: {
      where: { type: "coding_assistant"; enabled: true; archivedAt: null };
      distinct: ["organizationId"];
      select: { organizationId: true };
    }): Promise<{ organizationId: string }[]>;
  };
};

export class PrismaCostAttributionPolicyRepository extends CostAttributionPolicyRepository {
  private constructor(private readonly client: CostAttributionPrismaClient) {
    super();
  }

  static create(client: unknown): PrismaCostAttributionPolicyRepository {
    return new PrismaCostAttributionPolicyRepository(client as CostAttributionPrismaClient);
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

  async organizationsWithEnabledCodingAssistants(): Promise<string[]> {
    const rows = await this.client.aiToolEntry.findMany({
      where: { type: "coding_assistant", enabled: true, archivedAt: null },
      distinct: ["organizationId"],
      select: { organizationId: true },
    });
    return rows.map((row) => row.organizationId);
  }
}
