import { ResourceScope } from "@langwatch/kernel";
import { SecretsChain, SecretsResolver } from "@langwatch/secrets";

import { MemoryNotificationRepositories } from "../../repositories/memory/memory.notification.repositories.ts";
import type { NotificationRepositories } from "../../repositories/notification.repositories.ts";
import { NotificationApp } from "../notification.app.ts";

/** The notification app over memory repositories, for tests that need no database. */
export function createNotificationTestApp(
  input: Readonly<{ repositories?: NotificationRepositories }> = {},
): Promise<NotificationApp> {
  const secrets = SecretsResolver.over(SecretsChain.start({ environment: {} })).scopeTo(
    "notification",
    Object.values(NotificationApp.secrets),
  );

  return NotificationApp.create({
    repositories: input.repositories ?? MemoryNotificationRepositories.create(),
    dependencies: {},
    config: {
      defaultFrom: undefined,
      provider: undefined,
      ses: { enabled: undefined, region: undefined, endpoint: undefined },
      smtp: { host: undefined, port: undefined, user: undefined, secure: undefined },
    },
    resources: new ResourceScope(),
    secrets,
  });
}
