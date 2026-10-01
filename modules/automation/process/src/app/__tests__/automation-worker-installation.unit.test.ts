/**
 * @vitest-environment node
 * The automation module installed on the worker role: the pipeline it hosts, over memory.
 */
import type { AnalyticsApi } from "@langwatch/analytics-contract";
import type { AnnotationApi } from "@langwatch/annotation-contract";
import { createApiFixture } from "@langwatch/api-fixture";
import type { AuditLogApi } from "@langwatch/audit-log-contract";
import type { AuthzApi } from "@langwatch/authz-contract";
import {
  AutomationApi,
  type AutomationServerConfig,
  type CreateTriggerCommand,
} from "@langwatch/automation-contract";
import { type DatasetApi, InvalidColumnError } from "@langwatch/dataset-contract";
import type { EntitlementApi } from "@langwatch/entitlement-contract";
import type { EvaluationApi } from "@langwatch/evaluation-contract";
import type { EvaluatorApi } from "@langwatch/evaluator-contract";
import { DispatchError, EventSourcing, InMemoryProcessStore } from "@langwatch/eventing";
import { EventStoreMemory } from "@langwatch/eventing/testing";
import type { MonitorApi } from "@langwatch/monitor-contract";
import type { NotificationService, SendEmailCommand } from "@langwatch/notification-contract";
import { PrismaClient } from "@langwatch/prisma-client/generated";
import { createApp, withMemoryRepositories } from "@langwatch/process";
import { memoryStores } from "@langwatch/process-stores";
import type { ProjectApi } from "@langwatch/project-contract";
import { SecretsChain, SecretsResolver } from "@langwatch/secrets";
import type { SlackApi } from "@langwatch/slack-contract";
import { createTestLogger } from "@langwatch/test-harness";
import { memoryRedisDouble } from "@langwatch/test-harness/client-doubles/redis";
import { Temporal, toDate } from "@langwatch/time";
import type { TraceApi } from "@langwatch/trace-contract";
import type { WebhookApi, WebhookSendRequest } from "@langwatch/webhook-contract";
import { describe, expect, it, vi } from "vitest";

import {
  SettlementProjectService,
  settlementContext,
  settlementSummary,
  settlementTrace,
} from "../../__tests__/fixtures/settlement.fixtures.ts";
import { automationServer } from "../../automation.server.ts";
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
  authz?: AuthzApi;
  notification?: NotificationService;
  webhook?: WebhookApi;
  logger?: ReturnType<typeof createTestLogger>["logger"];
}>;

function composed(role: "api" | "worker", eventing: EventSourcing, installed: Installed = {}) {
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
    .withMember("logging", installed.logger ?? createTestLogger().logger);
}

function peers(installed: Installed = {}) {
  return {
    analytics: createApiFixture<AnalyticsApi>(),
    monitor: createApiFixture<MonitorApi>(),
    evaluator: createApiFixture<EvaluatorApi>(),
    entitlement: installed.entitlement ?? createApiFixture<EntitlementApi>(),
    project: installed.project ?? createApiFixture<ProjectApi>(),
    "audit-log": createApiFixture<AuditLogApi>(),
    trace: installed.trace ?? createApiFixture<TraceApi>(),
    evaluation: createApiFixture<EvaluationApi>(),
    dataset: installed.dataset ?? createApiFixture<DatasetApi>(),
    annotation: installed.annotation ?? createApiFixture<AnnotationApi>(),
    authz: installed.authz ?? createApiFixture<AuthzApi>(),
    notification: installed.notification ?? createApiFixture<NotificationService>(),
    slack: createApiFixture<SlackApi>(),
    webhook: installed.webhook ?? createApiFixture<WebhookApi>(),
  };
}

function process(role: "api" | "worker", eventing: EventSourcing, installed: Installed = {}) {
  return composed(role, eventing, installed).provide(peers(installed));
}

/** A worker whose process supplies every peer but `absent`. */
function bootWithout(absent: keyof ReturnType<typeof peers>) {
  const supplied = Object.fromEntries(
    Object.entries(peers()).filter(([module]) => module !== absent),
  );
  return Promise.resolve().then(() =>
    // @ts-expect-error MissingSupply: the compiler refuses a worker missing a peer it names
    composed("worker", eventingFor("worker")).provide(supplied).boot(),
  );
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
      "automations:command:configureReportSchedule",
      "automations:command:pauseReportSchedule",
      "automations:command:recordTriggerMatch",
      "automations:command:requestReportRun",
      "automations:command:resumeReportSchedule",
      "automations:command:settleReportRun",
      "automations:subscriber:pm:reportSchedule",
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

  /** @scenario "The api sends report schedule commands but never runs the schedule" */
  it("names the report schedule among the process managers it will not run", async () => {
    const { unrun } = await installedOn("api");

    expect(unrun).toContain("reportSchedule");
  });
});

describe("given a worker process missing a peer settlement delivers through", () => {
  /** @scenario "A settlement half that cannot deliver never boots" */
  it("refuses the boot naming the mail dependency", async () => {
    await expect(bootWithout("notification")).rejects.toMatchObject({
      name: "MissingProviderError",
      feature: "automation",
      dependencyKey: "notifications",
    });
  });

  /** @scenario "An annotation-queue automation cannot run on a worker without the annotation peer" */
  it("refuses the boot naming the annotation dependency", async () => {
    await expect(bootWithout("annotation")).rejects.toMatchObject({
      name: "MissingProviderError",
      feature: "automation",
      dependencyKey: "annotations",
    });
  });

  /** @scenario "A breached ceiling is contained from every worker that boots" */
  it("refuses the boot naming the directory containment reads administrators from", async () => {
    await expect(bootWithout("authz")).rejects.toMatchObject({
      name: "MissingProviderError",
      feature: "automation",
      dependencyKey: "authorization",
    });
  });
});

function capturingMail(): { notification: NotificationService; sent: SendEmailCommand[] } {
  const sent: SendEmailCommand[] = [];
  const notification = createApiFixture<NotificationService>({
    sendEmail: async (message) => {
      sent.push(message);
    },
  });
  return { notification, sent };
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
  filters: CreateTriggerCommand["filters"] = {},
): CreateTriggerCommand {
  const lastRunAt = toDate(Temporal.Instant.fromEpochMilliseconds(0));
  return {
    id: "trigger-1",
    projectId: "project-1",
    name: "Settles",
    action,
    actionParams,
    filters,
    lastRunAt,
  };
}

describe("given a memory-tier worker settling a match end to end", () => {
  describe("when a settled window is notified through the pipeline's own intent handler", () => {
    /** @scenario "A settled match reaches its recipients from this process" */
    it("mails the digest from this deployment's host, claims the send and stamps the run", async () => {
      const { notification, sent } = capturingMail();
      const worker = await settlingWorker({ notification, trace: tracesHolding(["trace-1"]) });
      await worker.automations.create(automation("SEND_EMAIL", { members: ["ops@acme.test"] }));
      const window = { triggerId: "trigger-1", traceIds: ["trace-1"], boundary: 1_000 };

      await worker.run("notifyDigest", window);
      await worker.run("notifyDigest", window);

      expect(sent).toHaveLength(1);
      expect(sent[0]).toMatchObject({ to: "ops@acme.test", replyless: {} });
      expect(sent[0]?.html).toContain("https://app.langwatch.test");
      expect(await worker.lastRunAt()).toBeGreaterThan(0);
      await worker.runtime.stop();
    });
  });

  describe("when a settled window notifies a webhook automation", () => {
    /** @scenario "A webhook automation hands each attempt to the webhook module" */
    it("sends the attempt through the webhook module and rethrows its verdict for the outbox", async () => {
      const requests: WebhookSendRequest[] = [];
      const refusal = new DispatchError({
        message: "HTTP 503",
        retryable: true,
        retryAfterMs: 60_000,
      });
      const webhook = createApiFixture<WebhookApi>({
        sendRequest: async (request) => {
          requests.push(request);
          throw refusal;
        },
      });
      const worker = await settlingWorker({ webhook, trace: tracesHolding(["trace-1"]) });
      await worker.automations.create(
        automation("SEND_WEBHOOK", { url: "https://hooks.acme.test/in", method: "POST" }),
      );

      await expect(
        worker.run("notifyDigest", {
          triggerId: "trigger-1",
          traceIds: ["trace-1"],
          boundary: 1_000,
        }),
      ).rejects.toBe(refusal);

      expect(requests).toHaveLength(1);
      expect(requests[0]).toMatchObject({
        projectId: "project-1",
        url: "https://hooks.acme.test/in",
        method: "POST",
        label: 'Webhook for trigger "Settles"',
        source: { module: "automation", ref: "trigger-1" },
      });
      expect(requests[0]?.dispatchId).toMatch(/^evt_[0-9a-f]{32}$/);
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
            const columnName = input.entries
              .flatMap((entry) => Object.keys(entry))
              .find((key) => key !== "id" && key !== "question");
            if (columnName) {
              const refusal = { columnName, datasetName: "qa", validColumns: ["question"] };
              throw new InvalidColumnError(refusal);
            }
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
      expect(columns).toEqual([["id", "question"]]);
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
      expect(lines).toContainEqual(expect.objectContaining({ triggerId: "trigger-1", cap: 1 }));
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

function organizationOf(members: { email: string; role: "ADMIN" | "MEMBER" }[]): AuthzApi {
  const createdAt = toDate(Temporal.Instant.fromEpochMilliseconds(0));
  return createApiFixture<AuthzApi>({
    listOrganizationBindings: async ({ organizationId }) =>
      members.map(({ email, role }, index) => ({
        id: `binding-${index}`,
        organizationId,
        userId: `user-${index}`,
        groupId: null,
        apiKeyId: null,
        role,
        customRoleId: null,
        scopeType: "ORGANIZATION",
        scopeId: organizationId,
        createdAt,
        user: { id: `user-${index}`, name: null, email, image: null },
        group: null,
        apiKey: null,
        customRole: null,
      })),
  });
}

async function breachedWorker(input: {
  filters: CreateTriggerCommand["filters"];
  countTracesInLastDay: TraceApi["countTracesInLastDay"];
}) {
  const { notification, sent } = capturingMail();
  const appended: string[] = [];
  const worker = await settlingWorker({
    notification,
    entitlement: planWithCeiling(1),
    authz: organizationOf([
      { email: "admin@acme.test", role: "ADMIN" },
      { email: "member@acme.test", role: "MEMBER" },
    ]),
    trace: createApiFixture<TraceApi>({
      findSummary: async ({ traceId }) => settlementSummary(traceId),
      getById: async ({ traceId }) => settlementTrace(traceId),
      deriveEvents: async () => [],
      matchesTraceFilters: () => true,
      countTracesInLastDay: input.countTracesInLastDay,
    }),
    dataset: createApiFixture<DatasetApi>({
      batchCreateRecords: async ({ slugOrId }) => {
        appended.push(slugOrId);
        return [];
      },
    }),
  });
  const datasetMapping = { mapping: { question: { source: "input" } }, expansions: [] };
  await worker.automations.create(
    automation("ADD_TO_DATASET", { datasetId: "dataset-1", datasetMapping }, input.filters),
  );
  await worker.run("persistMatch", { triggerId: "trigger-1", traceIds: ["trace-1", "trace-2"] });
  const trigger = await worker.automations.getById({
    triggerId: "trigger-1",
    projectId: "project-1",
  });
  await worker.runtime.stop();
  return { sent, appended, trigger };
}

describe("given a memory-tier worker whose automation passes its plan's ceiling", () => {
  /** @scenario "A misconfigured automation is paused and its administrators are told" */
  it("pauses a condition-less automation for runaway volume and mails only the administrators", async () => {
    const { sent, appended, trigger } = await breachedWorker({
      filters: {},
      countTracesInLastDay: async () => 1_000_000,
    });

    expect(trigger.active).toBe(false);
    expect(trigger.pausedReason).toBe("runaway_volume");
    expect(sent.map(({ to }) => to)).toEqual(["admin@acme.test"]);
    expect(appended).toEqual(["dataset-1"]);
  });

  /** @scenario "An automation that merely reached its ceiling is told, not paused" */
  it("keeps a narrowed automation active, tells its administrators and reads the project's own traffic", async () => {
    const counted: string[] = [];
    const { sent, trigger } = await breachedWorker({
      filters: { "metadata.labels": ["checkout"] },
      countTracesInLastDay: async ({ projectId }) => {
        counted.push(projectId);
        return 1_000_000;
      },
    });

    expect(trigger.active).toBe(true);
    expect(sent.map(({ to }) => to)).toEqual(["admin@acme.test"]);
    expect(counted).toEqual(["project-1"]);
  });
});

async function reportingWorker() {
  const eventing = eventingFor("worker");
  const runtime = await process("worker", eventing, {
    project: new SettlementProjectService(),
  }).boot();
  const automations = runtime.service(AutomationApi);
  await automations.create(
    automation("SEND_EMAIL", {
      members: ["ops@acme.test"],
      source: { kind: "dashboard", dashboardId: "dashboard-1" },
      schedule: { cron: "0 9 * * 1", timezone: "UTC" },
      compareToPrevious: false,
    }),
  );
  const schedule = async () =>
    (await automations.getReportSchedules({ projectId: "project-1" })).map(
      ({ nextRunAt, active }) => ({ nextRunAt: nextRunAt?.getUTCDay() ?? null, active }),
    );
  const sync = (cron: string) =>
    automations.syncReportSchedule({
      projectId: "project-1",
      triggerId: "trigger-1",
      cron,
      timezone: "UTC",
    });
  return { runtime, automations, schedule, sync };
}

describe("given a memory-tier worker hosting report schedules", () => {
  /** @scenario "Saving a report schedules it for its next send" */
  /** @scenario "A saved report starts counting without waiting for a restart" */
  /** @scenario "The automations page shows the next send that will actually happen" */
  it("reads the saved report's next Monday send back from its schedule process", async () => {
    const worker = await reportingWorker();

    await worker.sync("0 9 * * 1");

    await vi.waitFor(async () =>
      expect(await worker.schedule()).toEqual([{ nextRunAt: 1, active: true }]),
    );
    await worker.runtime.stop();
  });

  /** @scenario "Changing a report's cadence moves its next send" */
  it("moves the next send to Friday when the cadence changes", async () => {
    const worker = await reportingWorker();
    await worker.sync("0 9 * * 1");

    await worker.sync("0 17 * * 5");

    await vi.waitFor(async () =>
      expect(await worker.schedule()).toEqual([{ nextRunAt: 5, active: true }]),
    );
    await worker.runtime.stop();
  });

  /** @scenario "Pausing a report takes it off the schedule" */
  /** @scenario "Resuming a report puts it back on the schedule" */
  it("drops the next send on pause and restores it on the same entry on resume", async () => {
    const worker = await reportingWorker();
    await worker.sync("0 9 * * 1");

    await worker.automations.removeReportSchedule({
      projectId: "project-1",
      triggerId: "trigger-1",
    });
    await vi.waitFor(async () =>
      expect(await worker.schedule()).toEqual([{ nextRunAt: null, active: false }]),
    );

    await worker.sync("0 9 * * 1");
    await vi.waitFor(async () =>
      expect(await worker.schedule()).toEqual([{ nextRunAt: 1, active: true }]),
    );
    await worker.runtime.stop();
  });

  /** @scenario "Deleting a report takes it off the schedule" */
  it("leaves a deleted report with no next send", async () => {
    const worker = await reportingWorker();
    await worker.sync("0 9 * * 1");

    await worker.automations.delete({ projectId: "project-1", triggerId: "trigger-1" });

    await vi.waitFor(async () => expect(await worker.schedule()).toEqual([]));
    await worker.runtime.stop();
  });
});
