import {
  EventingAuthzCommandDispatcherAdapter,
  KsuidAuthzBindingIdAdapter,
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
  IdentityProducerPipelinesAdapter,
  PostgresIdentityNewbornSweepAdapter,
  PostgresIdentityUserMigrationsAdapter,
} from "@langwatch/identity-process";
import {
  OpsSystemMigrations,
  RoutingTableOrganizationDataplaneAdapter,
  SystemMigrationsPassTask,
} from "@langwatch/ops-process";
import { RedisConnectionService, RedisShutdownService } from "@langwatch/redis-client";
import type { SystemMigration } from "@langwatch/system-migrations";

import type { TaskInput } from "./config.ts";
import { withDatabase } from "./database.ts";

export async function systemMigrationsPass(input: TaskInput): Promise<void> {
  await withDatabase(input.config, async (database) => {
    const redis = new RedisConnectionService().connect({ url: input.config.redisUrl });
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
      if (eventing) {
        const dispatcher = EventingAuthzCommandDispatcherAdapter.create();
        const bindingIds = KsuidAuthzBindingIdAdapter.create();
        const authz = PostgresAuthzAdapter.create({
          database,
          redis,
          dispatcher,
          newBindingId: () => bindingIds.newBindingId(),
        }).build();
        const registered = eventing.register(authz.pipeline);
        dispatcher.connect(EventingAuthzCommandDispatcherAdapter.sendersFrom(registered.commands));
        migrations.push(authz.migration);
      }

      const commands = new Map<string, { send(data: unknown): Promise<unknown> }>();
      if (eventing) {
        const registered = eventing.register(
          IdentityProducerPipelinesAdapter.create({
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
      const userMigrations = PostgresIdentityUserMigrationsAdapter.create({
        database,
        eventing: identity,
      }).build();
      const sweep = PostgresIdentityNewbornSweepAdapter.create({
        database,
        eventing: identity,
      }).build();
      const runner = OpsSystemMigrations.create({
        database,
        redis,
        isSaaS: () => input.config.isSaaS,
        migrations: () => migrations,
        userMigrations: () => userMigrations,
        dataplane: RoutingTableOrganizationDataplaneAdapter.create({
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
      try {
        await eventing?.close();
      } finally {
        if (redis) await RedisShutdownService.create().shutdown(redis);
      }
    }
  });
}
