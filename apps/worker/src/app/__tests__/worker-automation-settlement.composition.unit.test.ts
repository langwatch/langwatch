import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  AutomationClockPort,
  AutomationEmailCapService,
  AutomationPersistCapService,
  AutomationTraceRecordUnavailableError,
} from "@langwatch/automation-server";
import { ReactEmailMailRenderer } from "@langwatch/mail";
import { WorkerAutomationNotificationDeliveryAdapter } from "../../features/automation/automation-notification-delivery.adapter";
import {
  createWorkerAutomationSettlement,
  WorkerAutomationSettlementAbsenceReportPort,
} from "../worker-automation-settlement.composition";
import { resolveWorkerConfig } from "../../platform/config/worker.config";

/**
 * Spec: specs/automations/worker-automation-settlement-conversion.feature
 *
 * THE CONVERSION, asserted where it can actually fail. The definition used to
 * arrive from the application already registered, and nothing about
 * re-registering it could tell a graph that reaches its own collaborators from
 * one that was handed a finished object. So the assertions below build the real
 * definition from the composition root and drive its registered intent
 * handlers, observing the effect at the far end: a claim taken against this
 * process's own Postgres double, a digest that leaves through the transport it
 * was composed with, and the persist half refusing by name rather than dropping
 * a confirmed match.
 */

const ENVIRONMENT = {
  NODE_ENV: "test",
  BASE_HOST: "https://app.langwatch.test",
  NEXTAUTH_SECRET: "0f".repeat(32),
} as const;

const RECORDED: {
  absences: string[];
  mail: Array<{ to: string; bcc: string[] | undefined; subject: string; html: string }>;
  claims: Array<{ triggerId: string; traceId: string; projectId: string }>;
  lastRunAt: Array<{ triggerId: string; projectId: string }>;
  datasetAppends: Array<{
    slugOrId: string;
    projectId: string;
    entries: Array<Record<string, unknown>>;
  }>;
  annotatorChecks: Array<{ projectId: string; queueIds: string[]; userIds: string[] }>;
  existenceChecks: Array<{ projectId: string; traceIds: string[] }>;
  queueItems: Array<{
    projectId: string;
    traceIds: string[];
    queueIds: string[];
    userIds: string[];
    createdByUserId: string;
  }>;
  breaches: Array<{ cap: number; count: number; skipped: number }>;
  captured: string[];
} = {
  breaches: [],
  absences: [],
  mail: [],
  claims: [],
  lastRunAt: [],
  datasetAppends: [],
  annotatorChecks: [],
  existenceChecks: [],
  queueItems: [],
  captured: [],
};

function reset(): void {
  RECORDED.absences.length = 0;
  RECORDED.mail.length = 0;
  RECORDED.claims.length = 0;
  RECORDED.lastRunAt.length = 0;
  RECORDED.datasetAppends.length = 0;
  RECORDED.annotatorChecks.length = 0;
  RECORDED.existenceChecks.length = 0;
  RECORDED.queueItems.length = 0;
  RECORDED.breaches.length = 0;
  RECORDED.captured.length = 0;
  // The cap service caches a project's resolved ceiling for ten minutes in a
  // module-level map, and counts its slots in another. Both outlive a test.
  AutomationPersistCapService.resetMemoryStore();
}

/**
 * The composition's own logger, which is also where a TERMINAL persist refusal
 * lands: settlement captures it rather than rethrowing, because a refusal that
 * can never succeed must dead-letter visibly instead of redelivering forever.
 */
function recordingLogger() {
  return {
    error: (fields: Record<string, unknown>) => {
      if (typeof fields.error === "string") RECORDED.captured.push(fields.error);
      if (typeof fields.cap === "number") {
        RECORDED.breaches.push(
          fields as unknown as { cap: number; count: number; skipped: number },
        );
      }
    },
    warn: () => undefined,
    info: () => undefined,
    debug: () => undefined,
  } as never;
}

class RecordingAbsence extends WorkerAutomationSettlementAbsenceReportPort {
  withoutLegacyFilterMatching(): void {
    RECORDED.absences.push("legacyFilterMatching");
  }
  withoutTraceRecordRead(): void {
    RECORDED.absences.push("traceRecordRead");
  }
  withoutDatasetPersist(): void {
    RECORDED.absences.push("datasetPersist");
  }
  withoutAnnotationQueuePersist(): void {
    RECORDED.absences.push("annotationQueuePersist");
  }
  withoutRunawayContainment(): void {
    RECORDED.absences.push("runawayContainment");
  }
  withoutPlanResolvedPersistCap(): void {
    RECORDED.absences.push("planResolvedPersistCap");
  }
  withoutGraphAlertEvaluation(): void {
    RECORDED.absences.push("graphAlertEvaluation");
  }
  withoutNotificationDelivery(): void {
    RECORDED.absences.push("notificationDelivery");
  }
}

class FrozenClock extends AutomationClockPort {
  now(): Date {
    return new Date("2026-01-02T03:04:05.000Z");
  }
}

/** One row of the automations table, as this process's Postgres holds it. */
type TriggerRow = {
  id: string;
  action: string;
  actionParams: Record<string, unknown>;
} & Record<string, unknown>;

/** One active email automation over a filter query, as Postgres holds it. */
const TRIGGER_ROW: TriggerRow = {
  id: "trigger-1",
  projectId: "project-1",
  name: "Error rate",
  action: "SEND_EMAIL",
  triggerKind: "ALERT",
  actionParams: { members: ["ada@example.com"] },
  filters: {},
  filterQuery: null,
  active: true,
  deleted: false,
  alertType: null,
  message: "",
  lastRunAt: null,
  notificationCadence: "immediate",
  createdAt: new Date("2026-01-01T00:00:00.000Z"),
  updatedAt: new Date("2026-01-01T00:00:00.000Z"),
  customGraphId: null,
  emailSubjectTemplate: null,
  emailBodyTemplate: null,
  slackTemplate: null,
  slackTemplateType: null,
  webhookTemplate: null,
  traceDebounceMs: 0,
};

function prismaDouble(trigger: TriggerRow) {
  return {
    trigger: {
      findMany: async () => [trigger],
      findFirst: async () => trigger,
      findUnique: async () => trigger,
      update: async (input: { where: { id: string; projectId: string } }) => {
        RECORDED.lastRunAt.push({
          triggerId: input.where.id,
          projectId: input.where.projectId,
        });
        return trigger;
      },
    },
    triggerSent: {
      createMany: async (input: { data: Array<Record<string, string>> }) => {
        for (const row of input.data) {
          RECORDED.claims.push(
            row as unknown as { triggerId: string; traceId: string; projectId: string },
          );
        }
        return { count: 1 };
      },
      findFirst: async () => null,
      findMany: async () => [],
    },
    emailSuppression: { findMany: async () => [] },
    webhookEndpointDelivery: { create: async () => undefined },
    $queryRaw: async () => [],
  };
}

class RecordingMailer {
  defaultFrom(): string {
    return "LangWatch <contact@langwatch.ai>";
  }

  async send(content: {
    to: string;
    bcc?: string[];
    subject: string;
    html: string;
  }): Promise<unknown> {
    RECORDED.mail.push({
      to: content.to,
      bcc: content.bcc,
      subject: content.subject,
      html: content.html,
    });
    return {};
  }
}

/** The same automation, written to append its matches to a dataset. */
const DATASET_TRIGGER_ROW: TriggerRow = {
  ...TRIGGER_ROW,
  id: "trigger-2",
  action: "ADD_TO_DATASET",
  actionParams: {
    datasetId: "support-replies",
    datasetMapping: {
      mapping: {
        question: { source: "input" },
        answer: { source: "output" },
      },
      expansions: [],
    },
  },
};

/**
 * The same automation again, written to queue its matches for annotation.
 *
 * The annotator id carries the `user-`/`queue-` prefix the reference grammar
 * is written in, because that grammar is Annotation's and this process must
 * send what Annotation parses rather than what it would have parsed itself.
 */
const ANNOTATION_TRIGGER_ROW: TriggerRow = {
  ...TRIGGER_ROW,
  id: "trigger-3",
  action: "ADD_TO_ANNOTATION_QUEUE",
  actionParams: {
    annotators: [{ id: "user-ada", name: "Ada" }],
    createdByUserId: "user_ada",
  },
};

/** The same automation, saved against an annotator the grammar cannot read. */
const UNPARSEABLE_ANNOTATOR_TRIGGER_ROW: TriggerRow = {
  ...ANNOTATION_TRIGGER_ROW,
  id: "trigger-4",
  actionParams: {
    annotators: [{ id: "ada", name: "Ada" }],
    createdByUserId: "user_ada",
  },
};

/** One captured trace, as the process's own full-record read answers it. */
const TRACE_RECORD = {
  trace_id: "trace-1",
  project_id: "project-1",
  metadata: {},
  timestamps: { started_at: 1, inserted_at: 2, updated_at: 3 },
  input: { value: "how do I reset my password?" },
  output: { value: "open the settings page" },
  spans: [
    {
      span_id: "span-1",
      trace_id: "trace-1",
      type: "llm",
      timestamps: { started_at: 1, finished_at: 2 },
    },
  ],
};

type ComposeOverrides = {
  notifications?: boolean;
  datasets?: boolean;
  /** The organization plan the daily persist ceiling is resolved from. */
  plan?: { type: string; free: boolean; maxTriggerPersistDispatchesPerDay?: number };
  annotations?: boolean;
  /** Which trace ids this process's own storage says the project holds. */
  heldTraceIds?: string[];
  trigger?: TriggerRow;
};

function compose(over: ComposeOverrides = {}) {
  const config = resolveWorkerConfig(ENVIRONMENT);
  const delivery = tryDelivery(config, over.notifications !== false);

  return createWorkerAutomationSettlement({
    config,
    prisma: prismaDouble(over.trigger ?? TRIGGER_ROW) as never,
    clock: new FrozenClock(),
    ...(delivery ? { notifications: delivery } : {}),
    projects: {
      tryGetById: async () => ({ id: "project-1", name: "Acme", slug: "acme" }),
    } as never,
    traces: {
      tryGetSummary: async () => ({
        traceId: "trace-1",
        projectId: "project-1",
        input: "hello",
        output: "world",
        occurredAt: 1,
        spanCount: 1,
      }),
      // The reader this process composes when it holds no typed client: the
      // full record enriches a candidate the fold state already produced, so
      // an unavailable one degrades the digest's metadata rather than losing
      // the notification.
      getById: async () => {
        if (over.datasets !== true) {
          throw new AutomationTraceRecordUnavailableError("no full record read in this process");
        }
        return TRACE_RECORD;
      },
      classifyQuery: () => ({ evaluations: false, events: false, spans: false }),
      deriveEvents: async () => [],
    } as never,
    evaluations: { findRunsByTraceId: async () => [] } as never,
    heartbeat: { tryResolveClickHouseClient: async () => null } as never,
    ...(over.datasets === true ? { datasets: recordingDatasets() } : {}),
    ...(over.annotations === true
      ? { annotations: recordingAnnotations(over.heldTraceIds ?? ["trace-1"]) }
      : {}),
    ...(over.plan
      ? {
          plans: {
            plans: { getActivePlan: async () => over.plan! },
            projects: { getOrganizationId: async () => "org-1" },
          } as never,
        }
      : {}),
    redis: null,
    absence: new RecordingAbsence(),
    logger: recordingLogger(),
  });
}

/** Dataset's own write, recorded at the one call this path makes. */
function recordingDatasets() {
  return {
    batchCreateRecords: async (input: {
      slugOrId: string;
      projectId: string;
      entries: Array<Record<string, unknown>>;
    }) => {
      RECORDED.datasetAppends.push(input);
      return [];
    },
  } as never;
}

/**
 * Annotation's own service and the existence check it asks somebody else for.
 *
 * Both are recorded rather than asserted here: what this file is proving is
 * that the composition reaches Annotation's PACKAGED call — which is what
 * parses the annotator references, drops the ids this project does not hold and
 * upserts the items — rather than a second queueing implementation written in
 * this process. The two doubles stand where the Postgres adapter and the
 * ClickHouse repository stand in production.
 */
function recordingAnnotations(heldTraceIds: readonly string[]) {
  return {
    annotations: {
      assertAnnotatorReferences: async (input: {
        projectId: string;
        queueIds: string[];
        userIds: string[];
      }) => {
        RECORDED.annotatorChecks.push(input);
      },
      createQueueItems: async (input: {
        projectId: string;
        traceIds: string[];
        queueIds: string[];
        userIds: string[];
        createdByUserId: string;
      }) => {
        RECORDED.queueItems.push(input);
      },
    },
    findExistingTraceIds: async (input: { projectId: string; traceIds: string[] }) => {
      RECORDED.existenceChecks.push({ projectId: input.projectId, traceIds: [...input.traceIds] });
      return input.traceIds.filter((traceId) => heldTraceIds.includes(traceId));
    },
  } as never;
}

function tryDelivery(config: ReturnType<typeof resolveWorkerConfig>, wanted: boolean) {
  if (!wanted) return undefined;

  // The real delivery adapter, over a recording mailer: what is being asserted
  // is that a digest LEAVES, and swapping the adapter for a double would assert
  // the test's own object instead of the process's transport.
  return {
    baseHost: ENVIRONMENT.BASE_HOST,
    delivery: WorkerAutomationNotificationDeliveryAdapter.create({
      mailer: new RecordingMailer() as never,
      renderer: ReactEmailMailRenderer.create(),
      baseHost: ENVIRONMENT.BASE_HOST,
      ...(config.mail?.unsubscribeSigningSecret === undefined
        ? {}
        : { unsubscribeSigningSecret: config.mail.unsubscribeSigningSecret }),
    }),
    emailCaps: AutomationEmailCapService.create({ store: null }),
    crypto: {
      encrypt: (value: string) => value,
      decrypt: (value: string) => value,
    },
  };
}

/** The routing keys the frozen registry lists for `automations`. */
function frozenAutomationRoutingKeys(): string[] {
  const registry = JSON.parse(
    readFileSync(new URL("../../features/job-registry.json", import.meta.url), "utf8"),
  ) as { pipelines: Array<{ name: string; jobs: string[] }> };
  const pipeline = registry.pipelines.find((entry) => entry.name === "automations");
  if (!pipeline) throw new Error("automations is absent from the job registry");
  return pipeline.jobs;
}

type BuiltDefinition = {
  metadata: { name: string };
  aggregate: { type: string };
  foldProjections: Map<string, unknown>;
  stateProjections?: Map<string, unknown>;
  mapProjections: Map<string, unknown>;
  commands: ReadonlyArray<{ name: string }>;
  foldSubscribers: Map<string, unknown>;
  mapSubscribers: Map<string, unknown>;
  eventSubscribers: Map<string, unknown>;
  processManagers: Map<
    string,
    {
      config: {
        eventTypes: readonly string[];
        schedule?: { everyMs: number };
        intents: Record<string, { run: (payload: never, context: never) => Promise<void> | void }>;
      };
    }
  >;
};

function registeredKeys(definition: BuiltDefinition): Set<string> {
  const keys = new Set<string>();
  for (const name of definition.foldProjections.keys()) keys.add(`projection:${name}`);
  for (const name of definition.stateProjections?.keys() ?? []) keys.add(`stateProjection:${name}`);
  for (const name of definition.mapProjections.keys()) keys.add(`handler:${name}`);
  for (const command of definition.commands) keys.add(`command:${command.name}`);
  for (const name of definition.foldSubscribers.keys()) keys.add(`reactor:${name}`);
  for (const name of definition.mapSubscribers.keys()) keys.add(`reactor:${name}`);
  for (const name of definition.eventSubscribers.keys()) keys.add(`subscriber:${name}`);
  for (const [name, manager] of definition.processManagers) {
    if (manager.config.eventTypes.length > 0) keys.add(`subscriber:pm:${name}`);
  }
  return keys;
}

function build(over: ComposeOverrides = {}): BuiltDefinition {
  return compose(over).buildPipeline({
    retention: { deleteDispatchedBefore: async () => 0 },
  }) as unknown as BuiltDefinition;
}

describe("given the automations pipeline this process composes for itself", () => {
  describe("when the composition root builds it", () => {
    /** @scenario "The worker mounts every automation routing key" */
    it("registers exactly the routing keys the frozen registry lists", () => {
      reset();
      const registered = registeredKeys(build());
      const frozen = frozenAutomationRoutingKeys();

      expect(frozen.filter((key) => !registered.has(key))).toEqual([]);
      expect([...registered].filter((key) => !frozen.includes(key))).toEqual([]);
      expect(frozen).toHaveLength(2);
    });

    /** @scenario "The worker mounts every automation routing key" */
    it("names the pipeline and aggregate the queue routes on", () => {
      reset();
      const definition = build();

      expect(definition.metadata.name).toBe("automations");
      expect(definition.aggregate.type).toBe("trigger");
    });

    /**
     * The two sweeps declare no event types, so `ProcessRuntime` registers no
     * routing key for either — which is exactly why they can be absent from the
     * frozen registry and still have to WAKE here. Asserted so a future change
     * that gives one an event type is caught by the parity test above rather
     * than silently widening the registry.
     */
    /** @scenario "The worker mounts every automation routing key" */
    it("keeps the two sweeps on their schedules and off the routing table", () => {
      reset();
      const managers = build().processManagers;

      expect(managers.get("graphAlertSweep")?.config.eventTypes).toEqual([]);
      expect(managers.get("graphAlertSweep")?.config.schedule?.everyMs).toBeGreaterThan(0);
      expect(managers.get("webhookDeliveryPrune")?.config.eventTypes).toEqual([]);
      expect(managers.get("webhookDeliveryPrune")?.config.schedule?.everyMs).toBeGreaterThan(0);
    });
  });

  describe("when a settled window is notified", () => {
    /** @scenario "A settled match reaches its recipients from this process" */
    it("claims the send and delivers the digest through this process's own mailer", async () => {
      reset();
      const settlement = build().processManagers.get("triggerSettlement");
      if (!settlement) throw new Error("the pipeline registered no triggerSettlement");

      await settlement.config.intents.notifyDigest!.run(
        { triggerId: "trigger-1", traceIds: ["trace-1"], boundary: 1 } as never,
        { projectId: "project-1", messageKey: "digest:1", attempt: 1 } as never,
      );

      expect(RECORDED.mail).toHaveLength(1);
      expect(RECORDED.mail[0]!.subject).toBe("Trigger - Error rate");
      expect(RECORDED.mail[0]!.bcc).toEqual(["ada@example.com"]);
      // The link is built from this process's own BASE_HOST, not the app's.
      expect(RECORDED.mail[0]!.html).toContain(`${ENVIRONMENT.BASE_HOST}/acme/traces/trace-1`);
      // Two claims, and both matter. One is per RECIPIENT — the traceId slot
      // carries a hash of the address (ADR-031), so a retry after a partial
      // fan-out resumes rather than mailing everyone again — and one is the
      // per-trace claim that stops a redelivered window notifying twice.
      expect(RECORDED.claims).toHaveLength(2);
      expect(RECORDED.claims.map((claim) => claim.traceId)).toContain("trace-1");
      expect(RECORDED.claims.filter((claim) => claim.traceId !== "trace-1")).toHaveLength(1);
      expect(
        RECORDED.claims.every(
          (claim) => claim.triggerId === "trigger-1" && claim.projectId === "project-1",
        ),
      ).toBe(true);
      expect(RECORDED.lastRunAt).toEqual([{ triggerId: "trigger-1", projectId: "project-1" }]);
    });
  });

  describe("when this process composed no outbound delivery", () => {
    /** @scenario "A settlement half that cannot deliver says so" */
    it("reports the absence at composition rather than at the first silent digest", () => {
      reset();
      build({ notifications: false });

      expect(RECORDED.absences).toContain("notificationDelivery");
    });
  });

  describe("when the composition root builds it without the application's collaborators", () => {
    /** @scenario "A settlement half that cannot deliver says so" */
    it("names every capability it does not have", () => {
      reset();
      build();

      // `traceRecordRead` is absent from this list on purpose: the record read
      // is composed beside the trace reader, so the reads composition is what
      // reports it. Everything reported HERE is a decision this composition
      // makes.
      expect(RECORDED.absences).toEqual([
        "graphAlertEvaluation",
        "legacyFilterMatching",
        "datasetPersist",
        "annotationQueuePersist",
        "runawayContainment",
        "planResolvedPersistCap",
      ]);
    });
  });

  describe("when a confirmed match is appended to a dataset", () => {
    /** @scenario "A confirmed match is appended to its dataset from this process" */
    it("stops reporting the dataset write as absent once the writer is composed", () => {
      reset();
      build({ datasets: true, trigger: DATASET_TRIGGER_ROW });

      expect(RECORDED.absences).not.toContain("datasetPersist");
      expect(RECORDED.absences).toContain("annotationQueuePersist");
    });

    /** @scenario "A confirmed match is appended to its dataset from this process" */
    it("maps the trace onto the columns the automation named and appends them", async () => {
      reset();
      const settlement = build({
        datasets: true,
        trigger: DATASET_TRIGGER_ROW,
      }).processManagers.get("triggerSettlement");
      if (!settlement) throw new Error("the pipeline registered no triggerSettlement");

      await settlement.config.intents.persistMatch!.run(
        { triggerId: "trigger-2", traceIds: ["trace-1"], boundary: 1 } as never,
        { projectId: "project-1", messageKey: "persist:1", attempt: 1 } as never,
      );

      expect(RECORDED.datasetAppends).toHaveLength(1);
      expect(RECORDED.datasetAppends[0]!.slugOrId).toBe("support-replies");
      expect(RECORDED.datasetAppends[0]!.projectId).toBe("project-1");
      // The columns are the mapping's, and their values come out of the record
      // the read answered — which is what "the columns the customer previewed"
      // means, since the preview drives the same two functions.
      expect(RECORDED.datasetAppends[0]!.entries).toEqual([
        {
          id: "trigger-2-trace-1-0",
          selected: true,
          question: "how do I reset my password?",
          answer: "open the settings page",
        },
      ]);
      expect(RECORDED.lastRunAt).toEqual([{ triggerId: "trigger-2", projectId: "project-1" }]);
    });
  });

  describe("when a confirmed match is queued for annotation", () => {
    /** @scenario "A confirmed match is queued for annotation from this process" */
    it("stops reporting the annotation-queue write as absent once the writer is composed", () => {
      reset();
      build({ annotations: true, trigger: ANNOTATION_TRIGGER_ROW });

      expect(RECORDED.absences).not.toContain("annotationQueuePersist");
    });

    /** @scenario "A confirmed match is queued for annotation from this process" */
    it("checks the annotators against the project and queues the trace it holds", async () => {
      reset();
      const settlement = build({
        annotations: true,
        trigger: ANNOTATION_TRIGGER_ROW,
      }).processManagers.get("triggerSettlement");
      if (!settlement) throw new Error("the pipeline registered no triggerSettlement");

      await settlement.config.intents.persistMatch!.run(
        { triggerId: "trigger-3", traceIds: ["trace-1"], boundary: 1 } as never,
        { projectId: "project-1", messageKey: "persist:1", attempt: 1 } as never,
      );

      // The `user_ada` annotator reached the service as a USER reference, which
      // is Annotation's own parse of the `user-`/`queue-` grammar — a second
      // implementation here would be free to disagree with it.
      expect(RECORDED.annotatorChecks).toEqual([
        { projectId: "project-1", queueIds: [], userIds: ["ada"] },
      ]);
      expect(RECORDED.existenceChecks).toEqual([{ projectId: "project-1", traceIds: ["trace-1"] }]);
      expect(RECORDED.queueItems).toEqual([
        {
          projectId: "project-1",
          traceIds: ["trace-1"],
          queueIds: [],
          userIds: ["ada"],
          createdByUserId: "user_ada",
        },
      ]);
      expect(RECORDED.captured).toEqual([]);
      expect(RECORDED.lastRunAt).toEqual([{ triggerId: "trigger-3", projectId: "project-1" }]);
    });

    /**
     * The existence check is not decoration. An id this project does not hold
     * becomes a queue item a reviewer can open, cannot read and cannot get
     * past, so the packaged call drops it — and the drop is asserted here so a
     * composition that answered the check from Annotation's own tables, or
     * skipped it, is caught.
     */
    /** @scenario "A confirmed match is queued for annotation from this process" */
    it("queues nothing for a trace this process's own storage does not hold", async () => {
      reset();
      const settlement = build({
        annotations: true,
        heldTraceIds: [],
        trigger: ANNOTATION_TRIGGER_ROW,
      }).processManagers.get("triggerSettlement");
      if (!settlement) throw new Error("the pipeline registered no triggerSettlement");

      await settlement.config.intents.persistMatch!.run(
        { triggerId: "trigger-3", traceIds: ["trace-1"], boundary: 1 } as never,
        { projectId: "project-1", messageKey: "persist:1", attempt: 1 } as never,
      );

      expect(RECORDED.existenceChecks).toHaveLength(1);
      expect(RECORDED.queueItems).toEqual([
        {
          projectId: "project-1",
          traceIds: [],
          queueIds: [],
          userIds: ["ada"],
          createdByUserId: "user_ada",
        },
      ]);
    });
  });

  describe("when the project's plan carries its own daily persist ceiling", () => {
    /** @scenario "A confirmed match is held to the ceiling this project's plan grants" */
    it("stops reporting the plan-resolved ceiling as absent once the provider is composed", () => {
      reset();
      build({ plan: { type: "LAUNCH", free: false } });

      expect(RECORDED.absences).not.toContain("planResolvedPersistCap");
    });

    /**
     * The ceiling the plan grants, not the paid one this process used to assume.
     * A contract override of zero is the sharpest fixture available: it can only
     * come from the plan, so a composition that ignored the provider and kept
     * the fixed paid number would let the match through.
     */
    /** @scenario "A confirmed match is held to the ceiling this project's plan grants" */
    it("skips a confirmed match past the ceiling the project's own plan grants", async () => {
      reset();
      const settlement = build({
        datasets: true,
        plan: { type: "FREE", free: true, maxTriggerPersistDispatchesPerDay: 0 },
        trigger: DATASET_TRIGGER_ROW,
      }).processManagers.get("triggerSettlement");
      if (!settlement) throw new Error("the pipeline registered no triggerSettlement");

      await settlement.config.intents.persistMatch!.run(
        { triggerId: "trigger-2", traceIds: ["trace-1"], boundary: 1 } as never,
        { projectId: "project-1", messageKey: "persist:1", attempt: 1 } as never,
      );

      expect(RECORDED.datasetAppends).toEqual([]);
      expect(RECORDED.lastRunAt).toEqual([]);
      expect(RECORDED.breaches).toHaveLength(1);
      expect(RECORDED.breaches[0]).toMatchObject({ cap: 0, skipped: 1 });
    });

    /** @scenario "A confirmed match is held to the ceiling this project's plan grants" */
    it("appends the match when the plan's ceiling has room", async () => {
      reset();
      const settlement = build({
        datasets: true,
        plan: { type: "LAUNCH", free: false },
        trigger: DATASET_TRIGGER_ROW,
      }).processManagers.get("triggerSettlement");
      if (!settlement) throw new Error("the pipeline registered no triggerSettlement");

      await settlement.config.intents.persistMatch!.run(
        { triggerId: "trigger-2", traceIds: ["trace-1"], boundary: 1 } as never,
        { projectId: "project-1", messageKey: "persist:1", attempt: 1 } as never,
      );

      expect(RECORDED.datasetAppends).toHaveLength(1);
      expect(RECORDED.breaches).toEqual([]);
    });
  });

  describe("when the automation names an annotator the grammar cannot read", () => {
    /**
     * The reference is SAVED on the automation, so it parses the same way on
     * every redelivery. Annotation answers a caller with a 400 and settlement
     * retries anything that is not a terminal refusal, so a composition that
     * passed the 400 through would build a page that fails forever.
     */
    /** @scenario "An annotation-queue automation whose annotator cannot be read is refused once" */
    it("refuses terminally, naming the reference the automation carries", async () => {
      reset();
      const settlement = build({
        annotations: true,
        trigger: UNPARSEABLE_ANNOTATOR_TRIGGER_ROW,
      }).processManagers.get("triggerSettlement");
      if (!settlement) throw new Error("the pipeline registered no triggerSettlement");

      await settlement.config.intents.persistMatch!.run(
        { triggerId: "trigger-4", traceIds: ["trace-1"], boundary: 1 } as never,
        { projectId: "project-1", messageKey: "persist:1", attempt: 1 } as never,
      );

      // Captured means the page dead-lettered rather than being re-thrown for
      // redelivery, which is the whole point of the translation.
      expect(RECORDED.captured).toHaveLength(1);
      expect(RECORDED.captured[0]).toContain("parses as neither a queue nor a member");
      expect(RECORDED.captured[0]).toContain("(ada)");
      expect(RECORDED.queueItems).toEqual([]);
      expect(RECORDED.lastRunAt).toEqual([]);
    });
  });

  describe("when a confirmed match is queued for annotation by a process with no client", () => {
    /** @scenario "An annotation-queue automation without a database client is refused" */
    it("refuses by naming the client the write is composed over", async () => {
      reset();
      const settlement = build({
        datasets: true,
        trigger: ANNOTATION_TRIGGER_ROW,
      }).processManagers.get("triggerSettlement");
      if (!settlement) throw new Error("the pipeline registered no triggerSettlement");

      await settlement.config.intents.persistMatch!.run(
        { triggerId: "trigger-3", traceIds: ["trace-1"], boundary: 1 } as never,
        { projectId: "project-1", messageKey: "persist:1", attempt: 1 } as never,
      );

      expect(RECORDED.captured).toHaveLength(1);
      expect(RECORDED.captured[0]).toContain("composes no annotation queue writer");
      expect(RECORDED.captured[0]).toContain("typed Prisma client this graph was given");
      // Nothing was queued, nothing was appended and nothing was stamped: a
      // refusal must not look like a match that ran.
      expect(RECORDED.queueItems).toEqual([]);
      expect(RECORDED.datasetAppends).toEqual([]);
      expect(RECORDED.lastRunAt).toEqual([]);
    });
  });
});
