import { trackDeliveryProgress } from "@langwatch/eventing";

import type { ServerRole } from "./feature-installer.ts";

/** The store clients whose calls count as an outbox delivery's progress (ARCHITECTURE.md §9). */
const PROGRESS_STORES: ReadonlySet<string> = new Set([
  "prisma",
  "clickhouse",
  "clickhouseAdmin",
  "redis",
  "objectStorage",
  "operatorReads",
]);

/**
 * A dependency handed to a module, tracked so each call through it renews the
 * running outbox delivery's lease. Only a worker runs deliveries, so the api and
 * tasks processes get the dependency itself.
 */
export function trackedForRole<Dependency>({
  role,
  dependency,
}: {
  role: ServerRole;
  dependency: Dependency;
}): Dependency {
  return role === "worker" ? trackDeliveryProgress(dependency) : dependency;
}

/** The store members a module's repositories and channels read, their clients tracked as above. */
export function trackedStoresForRole({
  role,
  members,
}: {
  role: ServerRole;
  members: Readonly<Record<string, unknown>>;
}): Readonly<Record<string, unknown>> {
  if (role !== "worker") return members;
  return Object.fromEntries(
    Object.entries(members).map(([name, member]) => [
      name,
      PROGRESS_STORES.has(name) ? trackDeliveryProgress(member) : member,
    ]),
  );
}
