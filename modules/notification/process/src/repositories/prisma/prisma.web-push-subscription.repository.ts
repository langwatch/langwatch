import {
  webPushSubscriptionSchema,
  type WebPushSubscription,
} from "@langwatch/notification-contract";
import { PrismaRepository } from "@langwatch/prisma-client";
import { toDate, type Instant } from "@langwatch/time";

import type {
  WebPushSubscriptionRepository,
  WebPushSubscriptionWrite,
} from "../web-push-subscription.repository.ts";

export class PrismaWebPushSubscriptionRepository
  extends PrismaRepository.for("WebPushSubscription")
  implements WebPushSubscriptionRepository
{
  static readonly create = this.factory(
    (prisma) => new PrismaWebPushSubscriptionRepository(prisma),
  );

  async upsert(input: WebPushSubscriptionWrite): Promise<WebPushSubscription> {
    const row = await this.prisma.webPushSubscription.upsert({
      where: { endpoint: input.endpoint },
      create: input,
      update: {
        userId: input.userId,
        p256dh: input.p256dh,
        auth: input.auth,
        userAgent: input.userAgent,
      },
    });
    return webPushSubscriptionSchema.parse(row);
  }

  async findById(id: string): Promise<WebPushSubscription | null> {
    const row = await this.prisma.webPushSubscription.findUnique({ where: { id } });
    return row ? webPushSubscriptionSchema.parse(row) : null;
  }

  async findByUser(userId: string): Promise<WebPushSubscription[]> {
    const rows = await this.prisma.webPushSubscription.findMany({
      where: { userId },
      orderBy: { createdAt: "asc" },
    });
    return rows.map((row) => webPushSubscriptionSchema.parse(row));
  }

  async deleteForUser({ userId, endpoint }: { userId: string; endpoint: string }): Promise<void> {
    await this.prisma.webPushSubscription.deleteMany({ where: { userId, endpoint } });
  }

  async deleteById(id: string): Promise<void> {
    await this.prisma.webPushSubscription.deleteMany({ where: { id } });
  }

  async deleteAllForUser(userId: string): Promise<number> {
    const { count } = await this.prisma.webPushSubscription.deleteMany({ where: { userId } });
    return count;
  }

  async recordSuccess({ id, at }: { id: string; at: Instant }): Promise<void> {
    await this.prisma.webPushSubscription.updateMany({
      where: { id },
      data: { lastSuccessAt: toDate(at) },
    });
  }
}
