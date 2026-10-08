/**
 * An installed list's migration steps, read by booting it in the tasks role over memory stores:
 * no server, no store client, no secret beyond the environment handed in. A build lists the
 * image's code steps this way (coordinator ruling R1, 2026-10-08).
 */
import { parseProcessConfig } from "@langwatch/config";
import { EventSourcing, InMemoryProcessStore } from "@langwatch/eventing";
import { createLogger } from "@langwatch/observability";
import { memoryStores, systemClock } from "@langwatch/process-stores";
import { refuseDoubleClaims, SecretsChain, SecretsResolver } from "@langwatch/secrets";

import type { BootedRuntime } from "./application.ts";
import { processConfig } from "./config.ts";
import type { InstallableServerFeature } from "./feature-installer.ts";
import type { PreambleEnvironment, PreambleOwner } from "./preamble.ts";
import { createApp } from "./process-supply.ts";

const ROLE = "tasks";

/** The supply calls made here: its per-module type check does not close over a whole list. */
interface WholeListSupply {
  withModules(modules: readonly unknown[]): WholeListSupply;
  withConfig(config: unknown): WholeListSupply;
  withStores(stores: ReturnType<typeof memoryStores>): WholeListSupply;
  withMembers(members: Readonly<Record<string, unknown>>): WholeListSupply;
  withEventing(eventing: EventSourcing): WholeListSupply;
  boot(): Promise<BootedRuntime<Record<string, unknown>, unknown, unknown>>;
}

/** A raw client the memory tier never opens: any use names it. */
function unopened(name: string): object {
  return new Proxy(
    {},
    {
      get(_target, property) {
        if (property === "then") return undefined;
        throw new Error(`Memory stores open no ${name}; "${String(property)}" was read.`);
      },
    },
  );
}

/** Boots `modules` over memory stores, answers their steps in installation order, then stops. */
export async function migrationStepsOverMemory<Step extends { readonly id: string }>({
  name,
  modules,
  environment,
  isMigrationStep,
}: {
  name: string;
  modules: readonly (InstallableServerFeature & PreambleOwner)[];
  /** The only environment read; a build hands a fixed one so the list never varies by host. */
  environment: PreambleEnvironment;
  isMigrationStep: (contribution: unknown) => contribution is Step;
}): Promise<readonly Step[]> {
  const owners = processConfig(modules);
  const config = parseProcessConfig({ owners, environment });
  const resolver = SecretsResolver.over(SecretsChain.start({ environment }).withEnv());
  refuseDoubleClaims(owners);
  const declared = owners.flatMap((owner) => Object.values(owner.secrets ?? {}));
  await resolver.preflight(declared);
  const settings = config.process;
  const eventing = new EventSourcing({
    enabled: false,
    participation: "produce",
    processStore: InMemoryProcessStore.createForTesting(),
  });
  // The installed registries' store clients, as the tasks installation test supplies them
  // (apps/tasks/src/__tests__/tasks-installation...).
  const supply: WholeListSupply = createApp({
    role: ROLE,
    secrets: (owner, handles) => resolver.scopeTo(owner, handles),
  });
  const runtime = await supply
    .withModules(modules)
    .withConfig(config)
    .withStores(memoryStores())
    .withMembers({
      logger: createLogger(`${name}:migration-steps`),
      clock: systemClock(),
      encryption: unopened("encryption key"),
      prisma: unopened("Prisma client"),
      clickhouse: unopened("ClickHouse client"),
      idempotency: { claim: async () => true },
      rateLimiter: { check: async () => ({ allowed: true }) },
      redis: null,
      publicBaseUrl: settings.baseHost,
      serviceVersion: "migration-steps",
      telemetryExporter: {
        endpoint: void 0,
        withHeaders: <Out>(build: (headers: Readonly<Record<string, string>>) => Out): Out =>
          build({}),
      },
      nodeEnvironment: settings.nodeEnvironment,
      isSaas: settings.isSaas ?? false,
      processName: name,
    })
    .withEventing(eventing)
    .boot();
  try {
    return runtime.migrationSteps(isMigrationStep);
  } finally {
    await runtime.stop();
  }
}
