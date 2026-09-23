/**
 * The api installed as `main.ts` installs it, over memory stores (ARCHITECTURE.md §13).
 * @vitest-environment node
 * @see specs/platform/process-installation.feature
 */
import { createApiFixture } from "@langwatch/api-fixture";
import { auditLogNullServer } from "@langwatch/audit-log-null";
import { parseProcessConfig } from "@langwatch/config";
import { EventSourcing, InMemoryProcessStore } from "@langwatch/eventing";
import { serverModules } from "@langwatch/installed-server-modules";
import {
  bootInstalledProcess,
  ModuleApiToken,
  storesBackedMembers,
  withMemoryRepositories,
  type InstallableServerFeature,
} from "@langwatch/kernel";
import { processConfig } from "@langwatch/process-server";
import {
  aesEncryption,
  memoryStores,
  resolvedSecrets,
  systemClock,
  type ProcessMembers,
} from "@langwatch/process-stores";
import { PromptApi } from "@langwatch/prompt-contract";
import {
  refuseDoubleClaims,
  SecretsChain,
  SecretsResolver,
  type SecretHandle,
} from "@langwatch/secrets";
import { createTestLogger } from "@langwatch/test-harness";
import { describe, expect, it } from "vitest";

const ROLE = "api";
const installed = [...serverModules, auditLogNullServer] as const;

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

async function bootApi() {
  const owners = processConfig(installed, ROLE);
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
    processStore: InMemoryProcessStore.createForTesting(),
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
    modules: installed.map(overMemory),
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
        adminEmails: config.process.adminEmails,
        processName: "langwatch-api",
        producesPipelines: true,
        dataPrivacy: { directory: unreachable<object>("dataPrivacy.directory"), redaction: null },
        elevenLabsWebhook: void 0,
        storageResolver: void 0,
        storage: void 0,
        queue: void 0,
        content: void 0,
        gatewayInternalProtocol: {},
        connectJudge: null,
        monitor: void 0,
        topicClustering: {
          requestClustering: () =>
            Promise.reject(new Error("langwatch-api composes no topic clustering worker")),
        },
      }),
      close: async () => void 0,
    },
  });
  return { runtime, eventing };
}

const moduleApis = installed.flatMap((module) =>
  module.apiContract instanceof ModuleApiToken ? [module.apiContract] : [],
);

describe("the api process installation", () => {
  /** @scenario "Every installed module boots in the api role over memory stores" */
  it("boots every installed module and resolves each module's api through its token", async () => {
    const { runtime, eventing } = await bootApi();

    try {
      expect(moduleApis.length).toBeGreaterThan(0);
      for (const token of moduleApis) expect(runtime.service(token)).toBeDefined();
      expect(eventing.definitions.map((definition) => definition.metadata.name)).toContain(
        "trace_processing",
      );
      expect(installed.flatMap((module) => module.transports ?? [])).not.toEqual([]);
    } finally {
      await runtime.stop();
    }
  });

  /** @scenario "Two process installations share no state" */
  it("keeps what one installation writes out of another", async () => {
    const first = await bootApi();
    const second = await bootApi();

    try {
      await first.runtime
        .service(PromptApi)
        .createTag({ organizationId: "organization-1", name: "canary" });

      await expect(
        second.runtime.service(PromptApi).listTags({ organizationId: "organization-1" }),
      ).resolves.toEqual([]);
    } finally {
      await Promise.all([first.runtime.stop(), second.runtime.stop()]);
    }
  });
});
