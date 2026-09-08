/** Supplies this process's database to the feature-owned notification installer. */
import type { NotificationApi } from "@langwatch/notification-contract";
import { notificationServer } from "@langwatch/notification-server";
import { createApp } from "@langwatch/runtime-composition";

import type { ApiTrpcInfrastructure } from "../../platform/infrastructure/api-trpc.infrastructure.ts";

/**
 * The durable notification record, as this process holds it. One gate, and it
 * is the database: every operation here is a row read or written with an
 * organization id already in hand.
 */
export type ComposedNotificationFeature = Readonly<{ app: NotificationApi }>;

/** Installs the notification records over this process's own graph. */
export async function installApiNotification(options: {
  infrastructure: Pick<ApiTrpcInfrastructure, "prisma">;
}): Promise<ComposedNotificationFeature> {
  const { prisma } = options.infrastructure;

  const runtime = await createApp({ name: "langwatch-api" })
    .withPersistence("postgres", { prisma })
    .withInfrastructure({})
    .withFeature(notificationServer)
    .boot({ role: "api" });

  return { app: runtime.feature(notificationServer).provided };
}
