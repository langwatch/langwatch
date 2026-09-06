import {
  EventingAuthzCommandDispatcherAdapter,
  KsuidAuthzBindingIdAdapter,
  PostgresAuthzAdapter,
} from "@langwatch/authz-server";
import { IDENTITY_PIPELINE_NAME } from "@langwatch/identity-contract";
import {
  IdentityEventingPort,
  IdentityProducerPipelinesAdapter,
  PostgresIdentityNewbornSweepAdapter,
  PostgresIdentityUserMigrationsAdapter,
} from "@langwatch/identity-server";
import { parseRoutingTable } from "@langwatch/clickhouse-client";
import {
  PostgresSystemMigrationsAdapter,
  RoutingTableOrganizationDataplaneAdapter,
  SystemMigrationsPassTask,
} from "@langwatch/ops-server";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import type { SystemMigration } from "@langwatch/system-migrations";
import { TASKS_PROCESS_NAME, type TasksEventingInfrastructure } from "./tasks-eventing.composition";
import type { TasksHost } from "./tasks-host.composition";

/**
 * Main's worker-boot migration loop, as one more `&&` step of the image CMD,
 * after `lwql-provision`. Two registries on main's two tenant axes: the
 * authorization engine over organizations, the identity ones over users.
 */
export function buildSystemMigrationsPassTask({
  host,
  eventing,
}: {
  host: TasksHost;
  eventing: TasksEventingInfrastructure | undefined;
}): SystemMigrationsPassTask {
  // Composed once, not per pass, and SHARED by the user-rooted registry and
  // the sweep: registering the identity pipeline again would register the
  // same producer repeatedly.
  let identity: TasksIdentityEventing | undefined;
  const identityEventing = () => {
    identity ??= TasksIdentityEventing.create({ eventing });

    return identity;
  };
  let sweep: ReturnType<PostgresIdentityNewbornSweepAdapter["build"]> | undefined;
  return SystemMigrationsPassTask.create({
    pass: () => {
      const database = host.requirePrisma();
      const migrations = registeredMigrations({ host, eventing });
      const userMigrations = registeredUserMigrations({ database, eventing: identityEventing() });
      const runner = PostgresSystemMigrationsAdapter.create({
        database,
        redis: host.redis ?? null,
        isSaaS: () => host.config.isSaaS,
        migrations: () => migrations,
        userMigrations: () => userMigrations,
        // Read per pass rather than captured at boot, so a route added to the
        // deployment reaches the next pass without a restart.
        dataplane: RoutingTableOrganizationDataplaneAdapter.create({
          routes: parseRoutingTable(process.env).routes,
        }),
        newbornSweep: () => {
          sweep ??= newbornSweep({ database, eventing: identityEventing() });

          return sweep.runPass();
        },
      });
      return ({ signal }) => runner.runPass({ signal });
    },
  });
}

/**
 * The USER-rooted registry (ADR-101 §6), in main's order. Both stage through
 * this process's producer-only identity pipeline.
 */
export function registeredUserMigrations({
  database,
  eventing,
}: {
  database: PrismaClient;
  eventing: IdentityEventingPort;
}): readonly SystemMigration[] {
  return PostgresIdentityUserMigrationsAdapter.create({ database, eventing }).build();
}

/**
 * The abandoned-newborn sweep (ADR-116 §3) on the pass's own cadence. Its
 * erase stages through this process's producer-only identity pipeline; with
 * no queue the ledger refuses by name, which the pass logs rather than fails.
 */
function newbornSweep({
  database,
  eventing,
}: {
  database: PrismaClient;
  eventing: IdentityEventingPort;
}): ReturnType<PostgresIdentityNewbornSweepAdapter["build"]> {
  return PostgresIdentityNewbornSweepAdapter.create({ database, eventing }).build();
}

/** The identity command senders this process produces, or none at all. */
class TasksIdentityEventing extends IdentityEventingPort {
  static create({
    eventing,
  }: {
    eventing: TasksEventingInfrastructure | undefined;
  }): TasksIdentityEventing {
    if (!eventing) return new TasksIdentityEventing(null);
    const registered = eventing.eventSourcing.register(
      IdentityProducerPipelinesAdapter.create({
        processName: TASKS_PROCESS_NAME,
      }).identityPipeline(),
    );
    return new TasksIdentityEventing(registered.commands as Record<string, unknown>);
  }

  private constructor(private readonly commands: Record<string, unknown> | null) {
    super();
  }

  tryPipelineCommand(input: {
    pipeline: string;
    command: string;
  }): Promise<{ send(data: unknown): Promise<unknown> } | null> {
    if (input.pipeline !== IDENTITY_PIPELINE_NAME) return Promise.resolve(null);
    const sender = this.commands?.[input.command];
    return Promise.resolve(
      typeof (sender as { send?: unknown } | undefined)?.send === "function"
        ? (sender as { send(data: unknown): Promise<unknown> })
        : null,
    );
  }
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
