import type { PrismaClient } from "@langwatch/prisma-client/generated";

import type { NotificationRepositories } from "../notification.repositories.ts";
import { PrismaNotificationRepository } from "./prisma.notification.repository.ts";
import { PrismaWebPushSubscriptionRepository } from "./prisma.web-push-subscription.repository.ts";
import {
  PrismaWebPushVapidKeyRepository,
  type VapidKeyCipher,
} from "./prisma.web-push-vapid-key.repository.ts";

/** The live tier: Postgres, and the process cipher for the stored VAPID private key. */
export class PostgresNotificationRepositories {
  static readonly requires = ["prisma", "encryption"] as const;

  static create(
    members: Readonly<{ prisma: PrismaClient; encryption: VapidKeyCipher }>,
  ): NotificationRepositories {
    return {
      notifications: PrismaNotificationRepository.create({ prisma: members.prisma }),
      webPushSubscriptions: PrismaWebPushSubscriptionRepository.create({
        prisma: members.prisma,
      }),
      webPushVapidKeys: PrismaWebPushVapidKeyRepository.create({
        prisma: members.prisma,
        cipher: members.encryption,
      }),
    };
  }
}
