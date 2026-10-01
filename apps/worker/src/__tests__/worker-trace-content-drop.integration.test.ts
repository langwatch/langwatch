/**
 * The worker records a span with the content its organization's privacy rule drops already gone.
 * Live eventing over memory stores; only the project's rows sit in a migrated test database.
 * @vitest-environment node
 * @see specs/data-privacy/content-drop.feature
 */
import { createApiFixture } from "@langwatch/api-fixture";
import { parseProcessConfig } from "@langwatch/config";
import {
  DataPrivacyApi,
  PRIVACY_DROPPED_MARKER_ATTR,
  type DataPrivacyConfig,
} from "@langwatch/data-privacy-contract";
import { createTenantId, EventSourcing, InMemoryProcessStore } from "@langwatch/eventing";
import {
  createBlobMaintenancePipeline,
  createProcessManagerMaintenancePipeline,
  type BlobCleanupDeps,
  type ProcessRetentionSweepDeps,
} from "@langwatch/eventing/server";
import { EventStoreMemory } from "@langwatch/eventing/testing";
import { serverModules } from "@langwatch/installed-server-modules";
import {
  bootInstalledProcess,
  storesBackedMembers,
  withMemoryRepositories,
  type InstallableServerFeature,
} from "@langwatch/kernel";
import { generate } from "@langwatch/ksuid";
import { PrismaDriverAdapterService } from "@langwatch/prisma-client";
import { PrismaClient } from "@langwatch/prisma-client/generated";
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
import {
  SPAN_RECEIVED_EVENT_TYPE,
  spanReceivedEventDataSchema,
  TraceApi,
  type OtlpKeyValue,
  type RecordSpanCommandData,
} from "@langwatch/trace-contract";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";

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

const IO_ATTRIBUTES = {
  "langwatch.input": "the secret question",
  "langwatch.output": "the answer",
  "gen_ai.request.model": "gpt-5-mini",
};

function unreachable<Client extends object>(name: string): Client {
  return createApiFixture<Client>({}, `${name} (no raw client over memory stores)`);
}

/** The project module reads its rows from the test database: every other module is over memory. */
function overMemory(module: InstallableServerFeature<never>): InstallableServerFeature<never> {
  if (module.name === "project") return module;
  return module.repositoryRegistry === void 0 ? module : withMemoryRepositories(module);
}

async function bootWorker({ prisma }: { prisma: ProcessMembers["prisma"] }) {
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

  const eventStore = EventStoreMemory.createForTesting();
  const eventing = new EventSourcing({
    eventStore,
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
    modules: serverModules.map(overMemory),
    config,
    secrets: (owner, declared) => resolver.scopeTo(owner, declared),
    members: {
      ...storesBackedMembers(memoryStores(), {
        ...stores,
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
  return { runtime, eventing, eventStore };
}

type Worker = Awaited<ReturnType<typeof bootWorker>>;

function keyValues(record: Record<string, string>): OtlpKeyValue[] {
  return Object.entries(record).map(([key, value]) => ({ key, value: { stringValue: value } }));
}

function dropping(categories: { input?: "drop"; output?: "drop" }): DataPrivacyConfig {
  return {
    categories: {
      input: { disposition: categories.input ?? "capture" },
      output: { disposition: categories.output ?? "capture" },
    },
  };
}

const ns = `content-drop-${generate("test").toString()}`;

/** One organization with one project, seeded as rows: no module owns a memory seam for them. */
async function seedProject(prisma: PrismaClient, suffix: string) {
  const organization = await prisma.organization.create({
    data: { name: "Content Drop Org", slug: `--test-org-${ns}-${suffix}` },
  });
  const team = await prisma.team.create({
    data: {
      name: "Content Drop Team",
      slug: `--test-team-${ns}-${suffix}`,
      organizationId: organization.id,
    },
  });
  const project = await prisma.project.create({
    data: {
      name: "Content Drop Project",
      slug: `--test-project-${ns}-${suffix}`,
      apiKey: `--test-key-${ns}-${suffix}`,
      teamId: team.id,
      language: "python",
      framework: "openai",
    },
  });
  return { organizationId: organization.id, projectId: project.id };
}

/** Puts the whole organization under `config`. */
async function ruleFor({ runtime }: Worker, organizationId: string, config: DataPrivacyConfig) {
  await runtime.service(DataPrivacyApi).setForScope({
    organizationId,
    scope: { scopeType: "ORGANIZATION", scopeId: organizationId },
    personalOnly: false,
    config,
  });
}

/** Records one span through the trace pipeline and reads back the span the event carries. */
async function recordedSpanKeys(
  { eventing, eventStore }: Worker,
  {
    projectId,
    traceId,
    resourceAttributes = {},
  }: { projectId: string; traceId: string; resourceAttributes?: Record<string, string> },
): Promise<string[]> {
  const data: RecordSpanCommandData = {
    tenantId: projectId,
    occurredAt: Date.now(),
    span: {
      traceId,
      spanId: "span-1",
      name: "test-span",
      kind: 1,
      startTimeUnixNano: "1700000000500000000",
      endTimeUnixNano: "1700000002500000000",
      attributes: keyValues(IO_ATTRIBUTES),
      events: [],
      links: [],
      status: {},
      droppedAttributesCount: 0,
      droppedEventsCount: 0,
      droppedLinksCount: 0,
    },
    resource: { attributes: keyValues(resourceAttributes) },
    instrumentationScope: { name: "test-scope" },
    piiRedactionLevel: "ESSENTIAL",
  };
  await eventing.getPipeline("trace_processing").commands.recordSpan?.send(data);

  const events = await eventStore.getEvents({
    aggregateId: traceId,
    aggregateType: "trace",
    context: { tenantId: createTenantId(projectId) },
  });
  const received = spanReceivedEventDataSchema.parse(
    events.find((event) => event.type === SPAN_RECEIVED_EVENT_TYPE)?.data,
  );
  return received.span.attributes.map((attribute) => attribute.key);
}

describe.skipIf(!DB_URL)("given the worker records spans for a project", () => {
  const prisma = new PrismaClient({
    adapter: PrismaDriverAdapterService.create().create(DB_URL ?? "").adapter,
  });
  let worker: Worker;

  beforeEach(async () => {
    worker = await bootWorker({ prisma });
  });

  afterEach(async () => {
    await worker.runtime.stop();
  });

  afterAll(async () => {
    const where = { slug: { startsWith: `--test-org-${ns}` } };
    const organizations = await prisma.organization.findMany({ where, select: { id: true } });
    const organizationIds = organizations.map((organization) => organization.id);
    await prisma.project.deleteMany({
      where: { team: { organizationId: { in: organizationIds } } },
    });
    await prisma.team.deleteMany({ where: { organizationId: { in: organizationIds } } });
    await prisma.organization.deleteMany({ where: { id: { in: organizationIds } } });
    await prisma.$disconnect();
  });

  describe("when its organization's rule drops trace input", () => {
    /** @scenario Dropped input never reaches storage from the OpenTelemetry endpoint */
    it("records the span without its input, keeping its output and model", async () => {
      const { organizationId, projectId } = await seedProject(prisma, "otel");
      await ruleFor(worker, organizationId, dropping({ input: "drop" }));

      const keys = await recordedSpanKeys(worker, { projectId, traceId: "trace-otel" });

      expect(keys).not.toContain("langwatch.input");
      expect(keys).toContain("langwatch.output");
      expect(keys).toContain("gen_ai.request.model");
    });

    /** @scenario Dropping applies to traces from the REST collector too */
    it("drops the input of a span the REST collector sent as well", async () => {
      const { organizationId, projectId } = await seedProject(prisma, "rest");
      await ruleFor(worker, organizationId, dropping({ input: "drop" }));

      const keys = await recordedSpanKeys(worker, {
        projectId,
        traceId: "trace-rest",
        resourceAttributes: { "telemetry.sdk.name": "langwatch-rest" },
      });

      expect(keys).not.toContain("langwatch.input");
    });
  });

  describe("when its organization's rule drops input and output", () => {
    /** @scenario Dropping applies to gateway traffic */
    it("drops both from a gateway-origin span and marks the span as dropped", async () => {
      const { organizationId, projectId } = await seedProject(prisma, "gateway");
      await ruleFor(worker, organizationId, dropping({ input: "drop", output: "drop" }));

      const keys = await recordedSpanKeys(worker, {
        projectId,
        traceId: "trace-gateway",
        resourceAttributes: { "langwatch.origin": "gateway" },
      });

      expect(keys).not.toContain("langwatch.input");
      expect(keys).not.toContain("langwatch.output");
      expect(keys).toContain(PRIVACY_DROPPED_MARKER_ATTR);
    });
  });

  describe("when the trace summary folds a span whose input was dropped", () => {
    /** @scenario The trace-level computed input is cleared when input is dropped */
    it("reads back a folded summary with no computed input, keeping the computed output", async () => {
      const { organizationId, projectId } = await seedProject(prisma, "fold");
      await ruleFor(worker, organizationId, dropping({ input: "drop" }));

      await recordedSpanKeys(worker, { projectId, traceId: "trace-fold" });

      await expect
        .poll(() =>
          worker.runtime.service(TraceApi).findSummary({ projectId, traceId: "trace-fold" }),
        )
        .toMatchObject({ computedInput: null, computedOutput: expect.any(String) });
    });
  });

  describe("when a span was recorded before the rule existed", () => {
    /** @scenario Dropping does not scrub already-stored traces */
    it("keeps that span's input, dropping it only from spans recorded after", async () => {
      const { organizationId, projectId } = await seedProject(prisma, "retro");
      const before = await recordedSpanKeys(worker, { projectId, traceId: "trace-before" });
      await ruleFor(worker, organizationId, dropping({ input: "drop" }));

      const after = await recordedSpanKeys(worker, { projectId, traceId: "trace-after" });

      expect(before).toContain("langwatch.input");
      expect(after).not.toContain("langwatch.input");
    });
  });
});
