/** The api installed as `main.ts` installs it, over memory stores (ARCHITECTURE.md §13). */
import { createApiFixture } from "@langwatch/api-fixture";
import { parseProcessConfig } from "@langwatch/config";
import { EventSourcing } from "@langwatch/eventing";
import { serverModules } from "@langwatch/installed-server-modules";
import {
  bootInstalledProcess,
  storesBackedMembers,
  withMemoryRepositories,
  type ExposedSurface,
  type InstallableServerFeature,
  type TransportPeers,
} from "@langwatch/kernel";
import { processConfig } from "@langwatch/process-server";
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

const ROLE = "api";
/** Every value is harmless and invented: nothing here is read from `.env`. */
const SYNTHETIC_ENVIRONMENT: Readonly<Record<string, string>> = {
  NODE_ENV: "test",
  BASE_HOST: "http://langwatch.test",
};

function unreachable<Client extends object>(name: string): Client {
  return createApiFixture<Client>({}, `${name} (no raw client over memory stores)`);
}

function overMemory(module: InstallableServerFeature<never>): InstallableServerFeature<never> {
  return module.repositoryRegistry === void 0 ? module : withMemoryRepositories(module);
}

export async function bootApi({
  surface,
}: { surface?: (peers: TransportPeers) => ExposedSurface<unknown, unknown> } = {}) {
  const owners = processConfig(serverModules, ROLE);
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
    clickhouse: unreachable<ProcessMembers["clickhouse"]>("clickhouse"),
    objectStorage: unreachable<ProcessMembers["objectStorage"]>("objectStorage"),
    cache: unreachable<ProcessMembers["cache"]>("cache"),
    idempotency: { claim: async () => true },
    rateLimiter: { check: async () => ({ allowed: true }) },
    eventing,
    mail: unreachable<ProcessMembers["mail"]>("mail"),
  };
  const runtime = await bootInstalledProcess({
    role: ROLE,
    modules: serverModules.map(overMemory),
    ...(surface ? { surface } : {}),
    config,
    secrets: (owner, declared) => resolver.scopeTo(owner, declared),
    members: {
      ...storesBackedMembers(memoryStores(), {
        ...stores,
        // The memory answer for Redis is none: every Redis-backed member has a twin.
        redis: null,
        publicBaseUrl: config.process.baseHost,
        serviceVersion: "test",
        nodeEnvironment: config.process.nodeEnvironment,
        isSaas: config.process.isSaas ?? false,
        nlpServiceUrl: config.process.nlpServiceUrl,
        nlpCodeBlockTimeoutSeconds: config.process.nlpCodeBlockTimeoutSeconds,
        adminEmails: config.process.adminEmails,
        processName: "langwatch-api",
        dataPrivacy: { directory: unreachable<object>("dataPrivacy.directory") },
        storageResolver: void 0,
        storage: void 0,
        queue: void 0,
        content: void 0,
        gatewayInternalProtocol: {},
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
