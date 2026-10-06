import { type TransportPeers } from "@langwatch/api";
import { parseProcessConfig } from "@langwatch/config";
import { EventSourcing } from "@langwatch/eventing";
import {
  type BootedRuntime,
  createApp,
  type ExposedSurface,
  processConfig,
} from "@langwatch/process";
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
/** The api installed as `main.ts` installs it, over memory stores (ARCHITECTURE.md §13). */
import { createApiFixture } from "@langwatch/test-harness/api-fixture";

import { processModules } from "../process-modules.generated.ts";

const ROLE = "api";
/** Every value is harmless and invented: nothing here is read from `.env`. */
const SYNTHETIC_ENVIRONMENT: Readonly<Record<string, string>> = {
  NODE_ENV: "test",
  BASE_HOST: "http://langwatch.test",
  // The API-key pepper chain refuses a boot where none of its secrets is set.
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
  expose(surface: (peers: TransportPeers) => ExposedSurface<unknown, unknown>): WholeListSupply;
  boot(): Promise<BootedRuntime<Record<string, unknown>, unknown, unknown>>;
}

export async function bootApi({
  surface,
  eventing: runtimeEventing,
}: {
  surface?: (peers: TransportPeers) => ExposedSurface<unknown, unknown>;
  eventing?: EventSourcing;
} = {}) {
  const owners = processConfig(processModules, ROLE);
  const config = parseProcessConfig({ owners, environment: SYNTHETIC_ENVIRONMENT });
  const resolver = SecretsResolver.over(
    SecretsChain.start({ environment: SYNTHETIC_ENVIRONMENT }).withEnv(),
  );
  refuseDoubleClaims(owners);
  const declared: readonly SecretHandle<unknown>[] = owners.flatMap((owner) =>
    "secrets" in owner ? Object.values(owner.secrets ?? {}) : [],
  );
  await resolver.preflight(declared);

  const eventing =
    runtimeEventing ??
    new EventSourcing({
      enabled: false,
      participation: "produce",
      processManagerMode: "producer-only",
    });
  const supply: WholeListSupply = createApp({
    role: ROLE,
    secrets: (owner, handles) => resolver.scopeTo(owner, handles),
  });
  const configured = supply
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
      // The memory answer for Redis is none: every Redis-backed member has a twin.
      redis: null,
      publicBaseUrl: config.process.baseHost,
      serviceVersion: "test",
      // No collector: rum answers not configured unless the test names one.
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
      processName: "langwatch-api",
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
    .withEventing(eventing);
  const runtime = await (surface ? configured.expose(surface) : configured).boot();
  return { runtime, eventing };
}
