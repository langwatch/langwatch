import {
  AuthzCommandDispatcherService,
  AuthzBindingIdService,
  PostgresAuthzAdapter,
} from "@langwatch/authz-process";
import { parseRoutingTable } from "@langwatch/clickhouse-client";
import {
  createEventingGroupQueueFactory,
  EventSourcing,
  EventStoreProducerOnly,
} from "@langwatch/eventing";
import { GroupQueueDependenciesAdapter } from "@langwatch/group-queue";
import { IDENTITY_PIPELINE_NAME } from "@langwatch/identity-contract";
import {
  type IdentityEventing,
  IdentityProducerPipelines,
  IdentityNewbornSweep,
  IdentityOrganizationMigrations,
  IdentityUserMigrations,
} from "@langwatch/identity-process";
import {
  OpsSystemMigrations,
  RoutingTableOrganizationDataplaneService,
  SystemMigrationsPassTask,
} from "@langwatch/ops-process";
import type { SystemMigration } from "@langwatch/system-migrations";

import type { TaskInput } from "./config.ts";

export async function systemMigrationsPass(input: TaskInput): Promise<void> {
  const opened = input.connections.database;
  if (!opened) throw new Error("This task needs DATABASE_URL");

  const database = opened.client;
  const redis = input.connections.redis;
  let eventing: EventSourcing | undefined;
  try {
    if (redis) {
      eventing = new EventSourcing({
        enabled: true,
        eventStore: EventStoreProducerOnly.create({ processName: "langwatch-tasks" }),
        processManagerMode: "producer-only",
        queueFactory: createEventingGroupQueueFactory({
          dependencies: GroupQueueDependenciesAdapter.create({ redis }).dependencies(),
          consumersEnabled: false,
        }),
        consumersEnabled: false,
        executionTarget: "task",
        warnWhenProjectionsRunInline: false,
      });
    }

    const migrations: SystemMigration[] = [];
    migrations.push(...IdentityOrganizationMigrations.create({ database }).build());
    if (eventing) {
      const dispatcher = AuthzCommandDispatcherService.create();
      const bindingIds = AuthzBindingIdService.create();
      const authz = PostgresAuthzAdapter.create({
        database,
        redis,
        dispatcher,
        newBindingId: () => bindingIds.newBindingId(),
      }).build();
      const registered = eventing.register(authz.pipeline);
      dispatcher.connect(AuthzCommandDispatcherService.sendersFrom(registered.commands));
      migrations.push(authz.migration);
    }

    const commands = new Map<string, { send(data: unknown): Promise<unknown> }>();
    if (eventing) {
      const registered = eventing.register(
        IdentityProducerPipelines.create({
          processName: "langwatch-tasks",
        }).identityPipeline(),
      );
      for (const [name, sender] of Object.entries(registered.commands)) {
        commands.set(name, sender);
      }
    }
    const identity: IdentityEventing = {
      tryPipelineCommand: async ({ pipeline, command }) =>
        pipeline === IDENTITY_PIPELINE_NAME ? (commands.get(command) ?? null) : null,
    };
    const userMigrations = IdentityUserMigrations.create({
      database,
      eventing: identity,
    }).build();
    const sweep = IdentityNewbornSweep.create({
      database,
      eventing: identity,
    }).build();
    const runner = OpsSystemMigrations.create({
      database,
      redis,
      isSaaS: () => input.config.isSaaS,
      migrations: () => migrations,
      userMigrations: () => userMigrations,
      dataplane: RoutingTableOrganizationDataplaneService.create({
        routes: parseRoutingTable(input.environment).routes,
      }),
      newbornSweep: () => sweep.runPass(),
    });
    await SystemMigrationsPassTask.create({
      pass:
        () =>
        ({ signal }) =>
          runner.runPass({ signal }),
    }).run({ args: [], signal: input.signal });
  } finally {
    // The seam that opened the stores closes them; this closes what it made.
    await eventing?.close();
  }
}
