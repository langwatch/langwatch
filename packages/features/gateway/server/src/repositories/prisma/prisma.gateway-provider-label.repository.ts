import type { PrismaClient } from "@langwatch/prisma-client/generated";
import { GatewayProviderLabelRepository } from "../gateway-provider-label.repository";

export class PrismaGatewayProviderLabelRepository extends GatewayProviderLabelRepository {
  private constructor(private readonly prisma: PrismaClient) {
    super();
  }

  static create(prisma: PrismaClient): PrismaGatewayProviderLabelRepository {
    return new PrismaGatewayProviderLabelRepository(prisma);
  }

  async resolveProviderLabels(
    budgets: Array<{ providerKey: string | null }>,
  ): Promise<Map<string, string>> {
    const ids = [
      ...new Set(budgets.map((b) => b.providerKey).filter((k): k is string => Boolean(k))),
    ];
    if (ids.length === 0) return new Map();
    const rows = await this.prisma.modelProvider.findMany({
      where: { id: { in: ids } },
      select: { id: true, name: true, provider: true },
    });
    return new Map(rows.map((r) => [r.id, r.name || r.provider]));
  }
}
