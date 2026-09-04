import {
  EventingAuthzCommandDispatcherAdapter,
  KsuidAuthzBindingIdAdapter,
  PostgresAuthzAdapter,
} from "@langwatch/authz-server";
import { PostgresSystemMigrationsAdapter, SystemMigrationsPassTask } from "@langwatch/ops-server";
import type { SystemMigration } from "@langwatch/system-migrations";
import type { TasksEventingInfrastructure } from "./tasks-eventing.composition";
import type { TasksHost } from "./tasks-host.composition";

/**
 * Main's worker-boot migration loop, as one more `&&` step of the image CMD,
 * after `lwql-provision`. The registry is the organization-rooted
 * authorization-engine migration only; the identity ones are user-rooted.
 */
export function buildSystemMigrationsPassTask({
  host,
  eventing,
}: {
  host: TasksHost;
  eventing: TasksEventingInfrastructure | undefined;
}): SystemMigrationsPassTask {
  return SystemMigrationsPassTask.create({
    pass: () => {
      const database = host.requirePrisma();
      const migrations = registeredMigrations({ host, eventing });
      const runner = PostgresSystemMigrationsAdapter.create({
        database,
        redis: host.redis ?? null,
        isSaaS: () => host.config.isSaaS,
        migrations: () => migrations,
      });
      return ({ signal }) => runner.runPass({ signal });
    },
  });
}

/**
 * The authorization-engine migration over this process's producer-only
 * Eventing host: it states grants as commands and reads the projection back
 * through Prisma, so the worker folds what this appends.
 */
function registeredMigrations({
  host,
  eventing,
}: {
  host: TasksHost;
  eventing: TasksEventingInfrastructure | undefined;
}): readonly SystemMigration[] {
  if (!eventing) return [];
  const dispatcher = EventingAuthzCommandDispatcherAdapter.create();
  const bindingIds = KsuidAuthzBindingIdAdapter.create();
  const built = PostgresAuthzAdapter.create({
    database: host.requirePrisma(),
    redis: host.redis ?? null,
    dispatcher,
    newBindingId: () => bindingIds.newBindingId(),
  }).build();
  const registered = eventing.eventSourcing.register(built.pipeline);
  dispatcher.connect(EventingAuthzCommandDispatcherAdapter.sendersFrom(registered.commands));
  return [built.migration];
}
