import type { Prisma, PrismaClient } from "@prisma/client";
import { pruneWebhookDeliveries } from "~/server/webhooks/deliveryLog";
import type {
  WebhookDeliveryInput,
  WebhookDeliveryRepository,
  WebhookDeliveryRow,
  WebhookFailureResponse,
} from "./webhook-delivery.repository";

/**
 * The automations channel's view of the shared delivery log. Both channels
 * write one row per HTTP attempt into `WebhookEndpointDelivery`; `channel`
 * says which pair of tenancy columns a row carries, and this repository only
 * ever reads and writes its own.
 */
export class PrismaWebhookDeliveryRepository
  implements WebhookDeliveryRepository
{
  constructor(private readonly prisma: PrismaClient) {}

  async create(input: WebhookDeliveryInput): Promise<void> {
    await this.prisma.webhookEndpointDelivery.create({
      data: {
        channel: "automations",
        projectId: input.projectId,
        triggerId: input.triggerId,
        dispatchId: input.dispatchId,
        responseStatus: input.responseStatus ?? null,
        latencyMs: input.latencyMs ?? null,
        error: input.error ?? null,
        response: (input.response ?? undefined) as
          | Prisma.InputJsonValue
          | undefined,
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
    const rows = await this.prisma.webhookEndpointDelivery.findMany({
      where: { channel: "automations", projectId, triggerId },
      orderBy: { firedAt: "desc" },
      take: limit,
    });
    return rows.map((row) => ({
      id: row.id,
      triggerId: row.triggerId ?? triggerId,
      dispatchId: row.dispatchId,
      responseStatus: row.responseStatus,
      latencyMs: row.latencyMs,
      error: row.error,
      response: (row.response as WebhookFailureResponse | null) ?? null,
      outcome: row.outcome,
      firedAt: row.firedAt,
    }));
  }

  /**
   * Retention runs through the shared sweep, which prunes both channels in one
   * statement. The per-project loop this replaced existed only to satisfy the
   * tenancy guard, and it deleted rows of one channel while the platform's own
   * sweep deleted the other's — two passes over what is now one table.
   */
  async pruneExpired(now?: Date): Promise<number> {
    return await pruneWebhookDeliveries({ prisma: this.prisma, now });
  }
}
