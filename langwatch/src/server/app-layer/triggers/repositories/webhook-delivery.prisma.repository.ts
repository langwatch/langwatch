import type { Prisma, PrismaClient } from "@prisma/client";
import type {
  WebhookDeliveryInput,
  WebhookDeliveryRepository,
  WebhookDeliveryRow,
} from "./webhook-delivery.repository";

export class PrismaWebhookDeliveryRepository
  implements WebhookDeliveryRepository
{
  constructor(private readonly prisma: PrismaClient) {}

  async create(input: WebhookDeliveryInput): Promise<void> {
    await this.prisma.webhookDelivery.create({
      data: {
        projectId: input.projectId,
        triggerId: input.triggerId,
        dispatchId: input.dispatchId,
        requestMethod: input.requestMethod,
        requestUrl: input.requestUrl,
        requestHeaders: input.requestHeaders as Prisma.InputJsonValue,
        responseStatus: input.responseStatus ?? null,
        responseBody: input.responseBody ?? null,
        latencyMs: input.latencyMs ?? null,
        error: input.error ?? null,
        outcome: input.outcome,
      },
    });
  }

  async findAllRecentByTriggerId({
    projectId,
    triggerId,
    limit,
  }: {
    projectId: string;
    triggerId: string;
    limit: number;
  }): Promise<WebhookDeliveryRow[]> {
    const rows = await this.prisma.webhookDelivery.findMany({
      where: { projectId, triggerId },
      orderBy: { firedAt: "desc" },
      take: limit,
    });
    return rows.map((row) => ({
      id: row.id,
      triggerId: row.triggerId,
      dispatchId: row.dispatchId,
      requestMethod: row.requestMethod,
      requestUrl: row.requestUrl,
      requestHeaders: (row.requestHeaders ?? {}) as Record<string, string>,
      responseStatus: row.responseStatus,
      responseBody: row.responseBody,
      latencyMs: row.latencyMs,
      error: row.error,
      outcome: row.outcome,
      firedAt: row.firedAt,
    }));
  }

  async deleteOlderThan({
    projectIds,
    before,
  }: {
    projectIds: string[];
    before: Date;
  }): Promise<number> {
    const { count } = await this.prisma.webhookDelivery.deleteMany({
      where: { projectId: { in: projectIds }, firedAt: { lt: before } },
    });
    return count;
  }
}
