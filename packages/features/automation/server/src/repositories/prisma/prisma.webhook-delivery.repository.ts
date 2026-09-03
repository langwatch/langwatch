import type {
  WebhookDeliveryInput,
  WebhookDeliveryRow,
  WebhookFailureResponse,
} from "@langwatch/automation-contract";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import { WebhookDeliveryRepository } from "../webhook-delivery.repository";

const RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

export class PrismaWebhookDeliveryRepository extends WebhookDeliveryRepository {
  private constructor(private readonly database: PrismaClient) {
    super();
  }

  static create(database: object): PrismaWebhookDeliveryRepository {
    return new PrismaWebhookDeliveryRepository(database as PrismaClient);
  }

  async create(input: WebhookDeliveryInput): Promise<void> {
    await this.database.webhookEndpointDelivery.create({
      data: {
        channel: "automations",
        projectId: input.projectId,
        triggerId: input.triggerId,
        dispatchId: input.dispatchId,
        responseStatus: input.responseStatus ?? null,
        latencyMs: input.latencyMs ?? null,
        error: input.error ?? null,
        response: input.response ?? undefined,
        outcome: input.outcome,
      },
    });
  }

  async findAllRecentByTriggerId(input: {
    projectId: string;
    triggerId: string;
    limit: number;
  }): Promise<WebhookDeliveryRow[]> {
    const rows = await this.database.webhookEndpointDelivery.findMany({
      where: {
        channel: "automations",
        projectId: input.projectId,
        triggerId: input.triggerId,
      },
      orderBy: { firedAt: "desc" },
      take: input.limit,
    });
    return rows.map((row: unknown) => {
      const value = row as Record<string, unknown>;
      return {
        id: String(value.id),
        triggerId: typeof value.triggerId === "string" ? value.triggerId : input.triggerId,
        dispatchId: String(value.dispatchId),
        responseStatus: typeof value.responseStatus === "number" ? value.responseStatus : null,
        latencyMs: typeof value.latencyMs === "number" ? value.latencyMs : null,
        error: typeof value.error === "string" ? value.error : null,
        response: (value.response as WebhookFailureResponse | null) ?? null,
        outcome: value.outcome as WebhookDeliveryRow["outcome"],
        firedAt: value.firedAt as Date,
      };
    });
  }

  async pruneExpired(now = new Date()): Promise<number> {
    const before = new Date(now.getTime() - RETENTION_MS);
    return this.database.$executeRaw`
			DELETE FROM "WebhookEndpointDelivery"
			WHERE "firedAt" < ${before}
			-- @tenancy: webhook delivery-log retention sweep (system-owned maintenance)
		`;
  }
}
