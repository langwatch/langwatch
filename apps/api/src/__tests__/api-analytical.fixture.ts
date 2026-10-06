import type { ClickHouseQueryClient } from "@langwatch/clickhouse-client";
import { parseProcessConfig } from "@langwatch/config";
import { EventSourcing } from "@langwatch/eventing";
import {
  bootInstalledProcess,
  type InstallableServerFeature,
  processConfig,
  storesBackedMembers,
  withMemoryRepositories,
} from "@langwatch/process";
import {
  aesEncryption,
  memoryStores,
  resolvedSecrets,
  systemClock,
  type ProcessMembers,
} from "@langwatch/process-stores";
import {
  refuseDoubleClaims,
  SecretsChain,
  SecretsResolver,
  type SecretHandle,
} from "@langwatch/secrets";
import { createTestLogger } from "@langwatch/test-harness";
/**
 * The api installed as `main.ts` installs it over memory stores (ARCHITECTURE.md §13), with a real
 * ClickHouse client handed in. memoryStores() states the memory tier for the whole process (§7), so
 * evaluation reads its memory repositories, not ClickHouse.
 */
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { memoryRedisDouble } from "@langwatch/test-harness/client-doubles/redis";

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

/** The modules whose analytical reads the suites compare; they run on memory like the rest (§7). */
const ANALYTICAL_MODULES: ReadonlySet<string> = new Set(["evaluation"]);

function overMemory(module: InstallableServerFeature<never>): InstallableServerFeature<never> {
  if (module.repositoryRegistry === void 0 || ANALYTICAL_MODULES.has(module.name)) return module;
  return withMemoryRepositories(module);
}

export async function bootApiOverClickHouse({ clickhouse }: { clickhouse: ClickHouseQueryClient }) {
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

  const prisma = unreachable<ProcessMembers["prisma"]>("prisma");
  const eventing = new EventSourcing({
    enabled: false,
    participation: "produce",
    processManagerMode: "producer-only",
  });
  const stores: Partial<ProcessMembers> = {
    logger: createTestLogger().logger,
    clock: systemClock(),
    secrets: resolvedSecrets({}),
    encryption: aesEncryption(new Uint8Array(32)),
    telemetry: unreachable<ProcessMembers["telemetry"]>("telemetry"),
    prisma,
    clickhouse,
    objectStorage: unreachable<ProcessMembers["objectStorage"]>("objectStorage"),
    cache: unreachable<ProcessMembers["cache"]>("cache"),
    idempotency: { claim: async () => true },
    rateLimiter: { check: async () => ({ allowed: true }) },
    eventing,
  };
  const runtime = await bootInstalledProcess({
    role: ROLE,
    modules: processModules.map(overMemory),
    config,
    secrets: (owner, declared) => resolver.scopeTo(owner, declared),
    members: {
      ...storesBackedMembers(memoryStores(), {
        ...stores,
        // Evaluation's live tier keeps its analytics fold cache in Redis.
        redis: memoryRedisDouble(),
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
          database: () => prisma,
        },
      }),
      close: async () => void 0,
    },
  });
  return { runtime, eventing };
}
