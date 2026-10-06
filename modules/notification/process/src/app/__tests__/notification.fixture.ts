import { EventSourcing, InMemoryProcessStore } from "@langwatch/eventing";
import { EventStoreMemory } from "@langwatch/eventing/testing";
import { ResourceScope } from "@langwatch/process";
import { SecretsChain, SecretsResolver } from "@langwatch/secrets";

import { MemoryNotificationRepositories } from "../../repositories/memory/memory.notification.repositories.ts";
import type { NotificationRepositories } from "../../repositories/notification.repositories.ts";
import { NotificationModule } from "../notification.app.ts";

/** The notification app over memory repositories, for tests that need no database. */
export function createNotificationTestApp(
  input: Readonly<{ repositories?: NotificationRepositories }> = {},
): Promise<NotificationModule> {
  const secrets = SecretsResolver.over(SecretsChain.start({ environment: {} })).scopeTo(
    "notification",
    Object.values(NotificationModule.secrets),
  );

  return NotificationModule.create({
    repositories: input.repositories ?? MemoryNotificationRepositories.create(),
    dependencies: {},
    config: {
      defaultFrom: undefined,
      provider: undefined,
      ses: { enabled: undefined, region: undefined, endpoint: undefined },
      smtp: { host: undefined, port: undefined, user: undefined, secure: undefined },
      publicBaseUrl: undefined,
      outboundProxy: {
        HTTPS_PROXY: undefined,
        https_proxy: undefined,
        HTTP_PROXY: undefined,
        http_proxy: undefined,
        NO_PROXY: undefined,
        no_proxy: undefined,
      },
    },
    resources: new ResourceScope(),
    secrets,
  });
}

/** An in-memory eventing runtime for a process that installs notification's pipeline. */
export function testEventing(): EventSourcing {
  return new EventSourcing({
    eventStore: EventStoreMemory.createForTesting(),
    processStore: InMemoryProcessStore.createForTesting(),
    executionTarget: "worker",
    consumersEnabled: true,
  });
}
