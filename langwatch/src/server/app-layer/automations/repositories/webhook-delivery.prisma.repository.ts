import type { PrismaClient } from "@prisma/client";
import type {
  WebhookDeliveryInput,
  WebhookDeliveryRepository,
  WebhookDeliveryRow,
  WebhookFailureKind,
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
        responseStatus: input.responseStatus ?? null,
        latencyMs: input.latencyMs ?? null,
        error: input.error ?? null,
        failureKind: input.failureKind ?? null,
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
      responseStatus: row.responseStatus,
      latencyMs: row.latencyMs,
      error: row.error,
      failureKind: (row.failureKind as WebhookFailureKind | null) ?? null,
      outcome: row.outcome,
      firedAt: row.firedAt,
    }));
  }

  async deleteOlderThan({ before }: { before: Date }): Promise<number> {
    // WebhookDelivery is project-scoped, so the Prisma tenancy guard rejects a
    // global deleteMany. Enumerate the global Project table, then prune each
    // tenant with projectId present in the destructive query.
    const projects = await this.prisma.project.findMany({
      select: { id: true },
    });
    let deleted = 0;
    for (const project of projects) {
      const result = await this.prisma.webhookDelivery.deleteMany({
        where: { projectId: project.id, firedAt: { lt: before } },
      });
      deleted += result.count;
    }
    return deleted;
  }
}
