import { parseProcessConfig } from "@langwatch/config";
import { EventSourcing, InMemoryProcessStore } from "@langwatch/eventing";
import {
  createBlobMaintenancePipeline,
  createProcessManagerMaintenancePipeline,
  type BlobCleanupDeps,
  type ProcessRetentionSweepDeps,
} from "@langwatch/eventing/server";
import { EventStoreMemory } from "@langwatch/eventing/testing";
import { LangyApi } from "@langwatch/langy-contract";
import { PrismaDriverAdapterService } from "@langwatch/prisma-client";
import { PrismaClient } from "@langwatch/prisma-client/generated";
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
 * The worker folds langy's conversation pipeline again: a created conversation is readable through
 * its projection. Live eventing over memory stores, langy's own rows in a migrated test database.
 * @vitest-environment node
 * @see modules/langy/specs/langy.feature
 */
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { afterAll, describe, expect, it } from "vitest";

import { processModules } from "../process-modules.generated.ts";

const DB_URL = process.env.LANGWATCH_TEST_DATABASE_URL;

const ROLE = "worker";
/** Every value is harmless and invented: nothing here is read from `.env`. */
const SYNTHETIC_ENVIRONMENT: Readonly<Record<string, string>> = {
  NODE_ENV: "test",
  // No quick tunnel from a test process: it would open a real one where cloudflared is on PATH.
  VOICE_TUNNEL: "false",
  BASE_HOST: "http://langwatch.test",
  // The API-key pepper chain refuses a boot where none of its secrets is set.
  API_KEY_PEPPER: "synthetic-api-key-pepper",
};

function unreachable<Client extends object>(name: string): Client {
  return createApiFixture<Client>({}, `${name} (no raw client over memory stores)`);
}

function overMemory(module: InstallableServerFeature<never>): InstallableServerFeature<never> {
  return module.repositoryRegistry === void 0 ? module : withMemoryRepositories(module);
}

async function bootWorker({ prisma }: { prisma: ProcessMembers["prisma"] }) {
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
  };
  const runtime = await bootInstalledProcess({
    role: ROLE,
    modules: processModules.map(overMemory),
    config,
    secrets: (owner, declared) => resolver.scopeTo(owner, declared),
    members: {
      ...storesBackedMembers(memoryStores(), {
        ...stores,
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
        processName: "langwatch-worker",
        storageResolver: void 0,
        storage: void 0,
        queue: void 0,
        content: void 0,
        connectJudge: null,
        rawSocketPort: 0,
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

describe.skipIf(!DB_URL)("given the worker with live eventing", () => {
  const prisma = new PrismaClient({
    adapter: PrismaDriverAdapterService.create().create(DB_URL ?? "").adapter,
  });
  const projectId = `project_r53_${Date.now()}`;
  const conversationId = `langyconv_r53_${Date.now()}`;

  afterAll(async () => {
    await prisma.langyConversationProjection.deleteMany({
      where: { projectId, ConversationId: conversationId },
    });
    await prisma.$disconnect();
  });

  describe("when langy's conversation pipeline is sent a created conversation", () => {
    /** @scenario "The worker folds a created langy conversation into its projection" */
    it("folds it, so the conversation is readable through the projection", async () => {
      const { runtime, eventing } = await bootWorker({ prisma });

      try {
        const pipeline = eventing.getPipeline("langy_conversation_processing");
        await pipeline.commands.createConversation?.send({
          tenantId: projectId,
          occurredAt: Date.now(),
          conversationId,
          userId: "user_r53",
          title: "Folded by the worker",
          runToken: "run_r53",
        });

        await expect(
          runtime.service(LangyApi).getById({ id: conversationId, projectId, userId: "user_r53" }),
        ).resolves.toMatchObject({ id: conversationId, title: "Folded by the worker" });
      } finally {
        await runtime.stop();
      }
    });
  });
});
