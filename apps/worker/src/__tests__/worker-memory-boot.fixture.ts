import { parseProcessConfig } from "@langwatch/config";
import { EventSourcing, InMemoryProcessStore } from "@langwatch/eventing";
import {
  createBlobMaintenancePipeline,
  createProcessManagerMaintenancePipeline,
  type BlobCleanupDeps,
  type ProcessRetentionSweepDeps,
} from "@langwatch/eventing/server";
import { EventStoreMemory } from "@langwatch/eventing/testing";
import { createApp, processConfig } from "@langwatch/process";
import {
  aesEncryption,
  memoryStores,
  resolvedSecrets,
  systemClock,
} from "@langwatch/process-stores";
import {
  refuseDoubleClaims,
  SecretsChain,
  SecretsResolver,
  type SecretHandle,
} from "@langwatch/secrets";
import { createTestLogger } from "@langwatch/test-harness";
/** The worker's installed list over `memoryStores()`, no server (§7, §13). */
import { createApiFixture } from "@langwatch/test-harness/api-fixture";

import { processModules } from "../process-modules.generated.ts";

const ROLE = "worker";

/** Every value is harmless and invented: nothing here is read from `.env`. */
export const SYNTHETIC_ENVIRONMENT: Readonly<Record<string, string>> = {
  NODE_ENV: "test",
  VOICE_TUNNEL: "false",
  BASE_HOST: "http://langwatch.test",
  API_KEY_PEPPER: "synthetic-api-key-pepper",
};

function unreachable<Client extends object>(name: string): Client {
  return createApiFixture<Client>({}, `${name} (no raw client over memory stores)`);
}

/**
 * The supply chain over the whole installed list: its per-module type check does not close over
 * thirty modules, so this names only the calls the harness makes.
 */
interface WholeListSupply {
  withModules(modules: readonly unknown[]): WholeListSupply;
  withConfig(config: unknown): WholeListSupply;
  withStores(stores: ReturnType<typeof memoryStores>): WholeListSupply;
  withMembers(members: Readonly<Record<string, unknown>>): WholeListSupply;
  withEventing(eventing: EventSourcing): WholeListSupply;
  boot(): Promise<{ stop(): Promise<void> }>;
}

/** Boots every installed module in the worker role; its eventing is returned to inspect. */
export async function bootMemoryWorker({
  environment = SYNTHETIC_ENVIRONMENT,
}: { environment?: Readonly<Record<string, string>> } = {}) {
  const owners = processConfig(processModules, ROLE);
  const config = parseProcessConfig({ owners, environment });
  const resolver = SecretsResolver.over(SecretsChain.start({ environment }).withEnv());
  refuseDoubleClaims(owners);
  const declared: readonly SecretHandle<unknown>[] = owners.flatMap((owner) =>
    "secrets" in owner ? Object.values(owner.secrets ?? {}) : [],
  );
  await resolver.preflight(declared);

  const eventing = new EventSourcing({
    eventStore: EventStoreMemory.createForTesting(),
    participation: "consume",
    processStore: InMemoryProcessStore.createForTesting(),
    maintenance: () => [
      createBlobMaintenancePipeline({ cleanup: unreachable<BlobCleanupDeps>("blob sweep") }),
      createProcessManagerMaintenancePipeline({
        retentionSweep: unreachable<ProcessRetentionSweepDeps>("process retention sweep"),
      }),
    ],
  });
  const supply: WholeListSupply = createApp({
    role: ROLE,
    secrets: (owner, handles) => resolver.scopeTo(owner, handles),
  });
  const runtime = await supply
    .withModules(processModules)
    .withConfig(config)
    .withStores(memoryStores())
    .withMembers({
      logger: createTestLogger().logger,
      clock: systemClock(),
      secrets: resolvedSecrets({}),
      encryption: aesEncryption(new Uint8Array(32)),
      telemetry: unreachable<object>("telemetry"),
      prisma: unreachable<object>("prisma"),
      clickhouse: unreachable<object>("clickhouse"),
      objectStorage: unreachable<object>("objectStorage"),
      cache: unreachable<object>("cache"),
      idempotency: { claim: async () => true },
      rateLimiter: { check: async () => ({ allowed: true }) },
      redis: null,
      publicBaseUrl: config.process.baseHost,
      serviceVersion: "test",
      telemetryExporter: {
        endpoint: void 0,
        withHeaders: <Out>(build: (headers: Readonly<Record<string, string>>) => Out): Out =>
          build({}),
      },
      nodeEnvironment: config.process.nodeEnvironment,
      isSaas: config.process.isSaas ?? false,
      nlpServiceUrl: config.process.nlpServiceUrl,
      nlpCodeBlockTimeoutSeconds: config.process.nlpCodeBlockTimeoutSeconds,
      nlpInternalSecret: void 0,
      outboundProxy: config.process.outboundProxy,
      processName: "langwatch-worker",
      storageResolver: void 0,
      storage: void 0,
      queue: void 0,
      content: void 0,
      connectJudge: null,
      monitor: void 0,
      langwatchQl: {
        admin: { configured: false },
        postgres: { configured: false },
        database: () => unreachable<object>("langwatchQl database"),
      },
    })
    .withEventing(eventing)
    .boot();
  return { runtime, eventing };
}
