/**
 * @vitest-environment node
 * The automation module installed on the worker role: the pipeline it hosts, over memory.
 */
import type { AnalyticsApi } from "@langwatch/analytics-contract";
import type { AnnotationApi } from "@langwatch/annotation-contract";
import { createApiFixture } from "@langwatch/api-fixture";
import type { AuditLogApi } from "@langwatch/audit-log-contract";
import {
  AutomationApi,
  type AutomationServerConfig,
  type CreateTriggerCommand,
} from "@langwatch/automation-contract";
import type { DatasetApi } from "@langwatch/dataset-contract";
import type { EntitlementApi } from "@langwatch/entitlement-contract";
import type { EvaluationApi } from "@langwatch/evaluation-contract";
import { EventSourcing, InMemoryProcessStore } from "@langwatch/eventing";
import { EventStoreMemory } from "@langwatch/eventing/testing";
import type { FeatureFlagApi } from "@langwatch/feature-flag-contract";
import { createApp, withMemoryRepositories } from "@langwatch/kernel";
import type { MonitorApi } from "@langwatch/monitor-contract";
import { PrismaClient } from "@langwatch/prisma-client/generated";
import { type Mail, memoryStores } from "@langwatch/process-stores";
import type { ProjectApi } from "@langwatch/project-contract";
import { SecretsChain, SecretsResolver } from "@langwatch/secrets";
import { createTestLogger } from "@langwatch/test-harness";
import { memoryRedisDouble } from "@langwatch/test-harness/client-doubles/redis";
import { Temporal, toDate } from "@langwatch/time";
import type { TraceApi } from "@langwatch/trace-contract";
import { describe, expect, it } from "vitest";

import { automationServer } from "../../automation.server.ts";
import {
  SettlementProjectService,
  settlementContext,
  settlementSummary,
  settlementTrace,
} from "../../fixtures/settlement.fixtures.ts";
import { AutomationPersistCapService } from "../../services/persist-cap.service.ts";

const CONFIG: AutomationServerConfig = {
  emailHourlyCap: 100,
  tenantDailyCap: 10_000,
  persistDailyCapFree: 50,
  persistDailyCapPaid: 500,
  persistDailyCapEnterprise: 5_000,
};

function eventingFor(role: "api" | "worker"): EventSourcing {
  const eventStore = EventStoreMemory.createForTesting();
  if (role === "api") {
    return new EventSourcing({
      eventStore,
      executionTarget: "api",
      consumersEnabled: false,
      processManagerMode: "producer-only",
    });
  }
  return new EventSourcing({
    eventStore,
    processStore: InMemoryProcessStore.createForTesting(),
    executionTarget: "worker",
    consumersEnabled: true,
  });
}

type Installed = Readonly<{
  project?: ProjectApi;
  trace?: TraceApi;
  entitlement?: EntitlementApi;
  dataset?: DatasetApi;
  annotation?: AnnotationApi;
  mail?: Mail;
  logger?: ReturnType<typeof createTestLogger>["logger"];
}>;

function process(role: "api" | "worker", eventing: EventSourcing, installed: Installed = {}) {
  const resolver = SecretsResolver.over(
    SecretsChain.start({ environment: { NEXTAUTH_SECRET: "session-secret" } }).withEnv(),
  );
  return createApp({ role, secrets: (owner, declared) => resolver.scopeTo(owner, declared) })
    .withModules([withMemoryRepositories(automationServer)])
    .withConfig({ automation: CONFIG })
    .withStores(memoryStores())
    .withEventing(eventing)
    .withKeyvalue(memoryRedisDouble())
    .withRelational(new PrismaClient({ accelerateUrl: "prisma://localhost/test" }))
    .withMember("encryption", {
      encrypt: (value: string) => value,
      decrypt: (value: string) => value,
    })
    .withMember("publicBaseUrl", "https://app.langwatch.test")
    .withMember("isSaas", false)
    .withMember("logging", installed.logger ?? createTestLogger().logger)
    .withMember("mail", installed.mail ?? createApiFixture<Mail>())
    .provide({
      analytics: createApiFixture<AnalyticsApi>(),
      monitor: createApiFixture<MonitorApi>(),
      "feature-flag": createApiFixture<FeatureFlagApi>(),
      entitlement: installed.entitlement ?? createApiFixture<EntitlementApi>(),
      project: installed.project ?? createApiFixture<ProjectApi>(),
      "audit-log": createApiFixture<AuditLogApi>(),
      trace: installed.trace ?? createApiFixture<TraceApi>(),
      evaluation: createApiFixture<EvaluationApi>(),
      dataset: installed.dataset ?? createApiFixture<DatasetApi>(),
      annotation: installed.annotation ?? createApiFixture<AnnotationApi>(),
    });
}

async function installedOn(role: "api" | "worker") {
  const eventing = eventingFor(role);
  const runtime = await process(role, eventing).boot();
  await runtime.stop();
  return { keys: [...eventing.globalJobRegistry.keys()], unrun: eventing.unrunProcessManagers };
}

describe("given the automation module installed on the worker role", () => {
  /** @scenario "The worker hosts every automation routing key" */
  it("claims the settlement process manager and the match command", async () => {
    const { keys } = await installedOn("worker");

    expect(keys.toSorted()).toEqual([
      "automations:command:recordTriggerMatch",
      "automations:subscriber:pm:triggerSettlement",
    ]);
  });

  /** @scenario "The worker runs trigger settlement itself" */
  it("leaves no automation process manager unrun", async () => {
    const { unrun } = await installedOn("worker");

    expect(unrun).toEqual([]);
  });
});

describe("given the automation module installed on the api role", () => {
  /** @scenario "The api registers trigger settlement without running it" */
  it("names the settlement process manager among those it will not run", async () => {
    const { unrun } = await installedOn("api");

    expect(unrun).toContain("triggerSettlement");
  });
});

type SentMail = Parameters<Mail["send"]>[0];

function capturingMail(): { mail: Mail; sent: SentMail[] } {
  const sent: SentMail[] = [];
  const mail: Mail = {
    send: async (message) => {
      sent.push(message);
    },
    defaultFrom: () => "LangWatch <no-reply@langwatch.test>",
  };
  return { mail, sent };
}

function tracesHolding(traceIds: string[]): TraceApi {
  return createApiFixture<TraceApi>({
    findSummary: async ({ traceId }) =>
      traceIds.includes(traceId) ? settlementSummary(traceId) : null,
    getById: async ({ traceId }) => settlementTrace(traceId),
    deriveEvents: async () => [],
  });
}

function planWithCeiling(ceiling: number): EntitlementApi {
  return createApiFixture<EntitlementApi>({
    getActivePlan: async () => ({
      planSource: "subscription",
      type: "LAUNCH",
      name: "Launch",
      free: false,
      maxMembers: 1,
      maxMembersLite: 1,
      maxMessagesPerMonth: 1,
      canPublish: true,
      prices: { USD: 0, EUR: 0 },
      maxTriggerPersistDispatchesPerDay: ceiling,
    }),
  });
}

async function settlingWorker(installed: Installed) {
  AutomationPersistCapService.resetPlanCache();
  const eventing = eventingFor("worker");
  const runtime = await process("worker", eventing, {
    project: new SettlementProjectService(),
    ...installed,
  }).boot();
  const intents = eventing.definitions
    .find(({ metadata }) => metadata.name === "automations")
    ?.processManagers.get("triggerSettlement")?.config.intents;
  const run = async (intent: string, payload: unknown): Promise<void> => {
    const spec = intents?.[intent];
    if (!spec) throw new Error(`the worker hosts no ${intent} intent`);
    await spec.run(spec.schema.parse(payload), settlementContext());
  };
  const automations = runtime.service(AutomationApi);
  const lastRunAt = async () =>
    (
      await automations.getById({ triggerId: "trigger-1", projectId: "project-1" })
    ).lastRunAt?.getTime();
  return { runtime, automations, run, lastRunAt };
}

function automation(
  action: CreateTriggerCommand["action"],
  actionParams: CreateTriggerCommand["actionParams"],
): CreateTriggerCommand {
  const lastRunAt = toDate(Temporal.Instant.fromEpochMilliseconds(0));
  return {
    id: "trigger-1",
    projectId: "project-1",
    name: "Settles",
    action,
    actionParams,
    lastRunAt,
  };
}

describe("given a memory-tier worker settling a match end to end", () => {
  describe("when a settled window is notified through the pipeline's own intent handler", () => {
    /** @scenario "A settled match reaches its recipients from this process" */
    it("mails the digest from this deployment's host, claims the send and stamps the run", async () => {
      const { mail, sent } = capturingMail();
      const worker = await settlingWorker({ mail, trace: tracesHolding(["trace-1"]) });
      await worker.automations.create(automation("SEND_EMAIL", { members: ["ops@acme.test"] }));
      const window = { triggerId: "trigger-1", traceIds: ["trace-1"], boundary: 1_000 };

      await worker.run("notifyDigest", window);
      await worker.run("notifyDigest", window);

      expect(sent).toHaveLength(1);
      expect(sent[0]?.bcc).toEqual(["ops@acme.test"]);
      expect(sent[0]?.html).toContain("https://app.langwatch.test");
      expect(await worker.lastRunAt()).toBeGreaterThan(0);
      await worker.runtime.stop();
    });
  });

  describe("when a confirmed match is persisted through the pipeline's own intent handler", () => {
    /** @scenario "A confirmed match is appended to its dataset from this process" */
    it("appends the mapped rows to the named dataset and stamps the run", async () => {
      const appended: Parameters<DatasetApi["batchCreateRecords"]>[0][] = [];
      const worker = await settlingWorker({
        trace: tracesHolding(["trace-1"]),
        entitlement: planWithCeiling(10),
        dataset: createApiFixture<DatasetApi>({
          batchCreateRecords: async (input) => {
            appended.push(input);
            return [];
          },
        }),
      });
      const datasetMapping = { mapping: { question: { source: "input" } }, expansions: [] };
      await worker.automations.create(
        automation("ADD_TO_DATASET", { datasetId: "dataset-1", datasetMapping }),
      );

      await worker.run("persistMatch", { triggerId: "trigger-1", traceIds: ["trace-1"] });

      expect(appended.map(({ slugOrId, projectId }) => ({ slugOrId, projectId }))).toEqual([
        { slugOrId: "dataset-1", projectId: "project-1" },
      ]);
      const columns = appended[0]?.entries.map((entry) => Object.keys(entry));
      expect(columns).toEqual([["id", "selected", "question"]]);
      expect(await worker.lastRunAt()).toBeGreaterThan(0);
      await worker.runtime.stop();
    });

    /** @scenario "A confirmed match is held to the ceiling this project's plan grants" */
    it("appends inside the plan's ceiling and records the breach against it", async () => {
      const { logger, lines } = createTestLogger();
      const appended: string[] = [];
      const worker = await settlingWorker({
        logger,
        trace: tracesHolding(["trace-1", "trace-2"]),
        entitlement: planWithCeiling(1),
        dataset: createApiFixture<DatasetApi>({
          batchCreateRecords: async ({ slugOrId }) => {
            appended.push(slugOrId);
            return [];
          },
        }),
      });
      const datasetMapping = { mapping: { question: { source: "input" } }, expansions: [] };
      await worker.automations.create(
        automation("ADD_TO_DATASET", { datasetId: "dataset-1", datasetMapping }),
      );

      await worker.run("persistMatch", {
        triggerId: "trigger-1",
        traceIds: ["trace-1", "trace-2"],
      });

      expect(appended).toEqual(["dataset-1"]);
      expect(lines.filter((line) => line.triggerId === "trigger-1" && line.cap === 1)).toHaveLength(
        1,
      );
      await worker.runtime.stop();
    });

    /** @scenario "A confirmed match is queued for annotation from this process" */
    it("queues only the traces this project holds, for the named annotators, and stamps the run", async () => {
      const queued: Parameters<AnnotationApi["queueTraces"]>[0][] = [];
      const worker = await settlingWorker({
        trace: tracesHolding(["trace-1"]),
        entitlement: planWithCeiling(10),
        annotation: createApiFixture<AnnotationApi>({
          queueTraces: async (input) => {
            queued.push(input);
            return { created: input.traceIds.length, skipped: 0 };
          },
        }),
      });
      await worker.automations.create(
        automation("ADD_TO_ANNOTATION_QUEUE", {
          annotators: [{ id: "user-2", name: "Ann" }],
          createdByUserId: "user-1",
        }),
      );

      await worker.run("persistMatch", {
        triggerId: "trigger-1",
        traceIds: ["trace-1", "trace-9"],
      });

      expect(queued).toEqual([
        { traceIds: ["trace-1"], projectId: "project-1", annotators: ["user-2"], userId: "user-1" },
      ]);
      expect(await worker.lastRunAt()).toBeGreaterThan(0);
      await worker.runtime.stop();
    });

    /** @scenario "An annotation-queue automation whose annotator cannot be read is refused once" */
    it("refuses terminally, queues nothing and leaves the run unstamped", async () => {
      const worker = await settlingWorker({
        trace: tracesHolding(["trace-1"]),
        entitlement: planWithCeiling(10),
        annotation: createApiFixture<AnnotationApi>({
          queueTraces: async () => {
            throw Object.assign(new Error("annotator"), {
              code: "annotation_annotator_reference_invalid",
            });
          },
        }),
      });
      await worker.automations.create(
        automation("ADD_TO_ANNOTATION_QUEUE", {
          annotators: [{ id: "not-a-reference", name: "?" }],
          createdByUserId: "user-1",
        }),
      );

      await expect(
        worker.run("persistMatch", { triggerId: "trigger-1", traceIds: ["trace-1"] }),
      ).resolves.toBeUndefined();
      expect(await worker.lastRunAt()).toBe(0);
      await worker.runtime.stop();
    });
  });
});
