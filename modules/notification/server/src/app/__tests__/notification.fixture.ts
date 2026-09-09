import { ResourceScope } from "@langwatch/runtime-composition";
import { MemoryNotificationRepositories } from "../../repositories/memory/memory.notification.repositories.ts";
import type { NotificationRepositories } from "../../repositories/notification.repositories.ts";
import { NotificationApp } from "../notification.app.ts";

/** The notification app over memory repositories, for tests that need no database. */
export function createNotificationTestApp(
  input: Readonly<{ repositories?: NotificationRepositories }> = {},
): NotificationApp {
  return NotificationApp.create({
    repositories: input.repositories ?? MemoryNotificationRepositories.create(),
    dependencies: {},
    config: void 0,
    resources: new ResourceScope(),
  });
}
