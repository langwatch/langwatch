/**
 * @vitest-environment node
 *
 * Full-flow dispatch integration test for the trigger-outbox feature.
 *
 * Drives a real trigger row (Postgres) through the actual dispatch code for
 * every action type and asserts it DELIVERS:
 *   - SEND_SLACK_MESSAGE  → real `sendSlackWebhook` runs (hooks.slack.com host
 *     guard + payload assembly); the @slack/webhook transport is mocked so we
 *     assert the webhook was hit with the built message.
 *   - SEND_EMAIL          → real `sendTriggerEmail` runs (per-recipient fan-out
 *     + render); the low-level `sendEmail` boundary is mocked so we assert the
 *     envelope (to / subject / html) that would go to SES.
 *   - ADD_TO_ANNOTATION_QUEUE → real `createOrUpdateQueueItems` writes a real
 *     `AnnotationQueueItem` row.
 *   - ADD_TO_DATASET      → real `createManyDatasetRecords` writes a real
 *     `DatasetRecord` row.
 *
 * Plus the customer safeguards on the email path:
 *   - the per-trigger hourly cap (ADR-031) drops over-cap dispatches, and
 *   - a Liquid template renders into the delivered notification.
 *
 * Everything ClickHouse-backed on the hot path is an injected dependency, so
 * the whole flow runs on Postgres + Redis with zero ClickHouse.
 */

import { generate } from "@langwatch/ksuid";
import { TriggerAction } from "@prisma/client";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { createOrUpdateQueueItems } from "~/server/api/routers/annotation";
import { createManyDatasetRecords } from "~/server/api/routers/datasetRecord.utils";
import { ProjectService } from "~/server/app-layer/projects/project.service";
import { PrismaProjectRepository } from "~/server/app-layer/projects/repositories/project.prisma.repository";
import type { TraceSummaryData } from "~/server/app-layer/traces/types";
import { PrismaTriggerRepository } from "~/server/app-layer/triggers/repositories/trigger.prisma.repository";
import { TriggerService } from "~/server/app-layer/triggers/trigger.service";
import { prisma } from "~/server/db";
import type { Trace } from "~/server/tracer/types";
import { KSUID_RESOURCES } from "~/utils/constants";
import { getTestProject, getTestUser } from "~/utils/testUtils";
import { dispatchTriggerAction } from "../../pipelines/shared/triggerActionDispatch";
import { createOutboxDispatcher } from "../dispatcher";
import {
  _resetMemoryEmailCapStore,
  consumeEmailCapSlot,
} from "../emailHourlyCap";
import {
  auditDedupKey,
  type CadenceStagePayload,
  type SettleStagePayload,
  TRIGGER_NOTIFY_REACTOR_NAME,
} from "../payload";

// ── Network-boundary mocks: the real provider code (host guard, payload
// assembly, Liquid render, per-recipient fan-out) runs; only the actual
// outbound call is captured. ──────────────────────────────────────────────
const { slackSendMock } = vi.hoisted(() => ({ slackSendMock: vi.fn() }));
vi.mock("@slack/webhook", () => ({
  IncomingWebhook: class {
    send = slackSendMock;
  },
}));

const { emailSendMock } = vi.hoisted(() => ({ emailSendMock: vi.fn() }));
vi.mock("~/server/mailer/emailSender", () => ({
  sendEmail: emailSendMock,
  computeDefaultFrom: () => "LangWatch <noreply@test.langwatch.ai>",
}));

const PROJECT_NAMESPACE = "trigger-dispatch-fullflow";
const SLACK_WEBHOOK = "https://hooks.slack.com/services/T000/B000/XXXXXXXX";

const triggers = new TriggerService(new PrismaTriggerRepository(prisma));
const projects = new ProjectService(new PrismaProjectRepository(prisma));

let projectId: string;
let userId: string;

/** Build the notify-path dispatcher deps. Real Postgres-backed triggers +
 *  projects; the cadence stage never reads the (stubbed) trace/eval deps. */
function makeNotifyDeps(opts?: { emailCap?: number }) {
  const cap = opts?.emailCap ?? 1000;
  return {
    triggers: triggers as any,
    projects: projects as any,
    baseHost: "https://app.example.com",
    traceSummaryStore: { get: vi.fn().mockResolvedValue(null), store: vi.fn() },
    evaluationRuns: { findByTraceId: vi.fn().mockResolvedValue([]) } as any,
    deriveEvents: vi.fn().mockResolvedValue([]),
    traceById: vi.fn().mockResolvedValue(undefined),
    // ADR-032: persist-class sinks. These notify-focused flows never
    // dispatch persist, so simple stubs satisfy the dispatcher deps.
    addToAnnotationQueue: vi.fn().mockResolvedValue(undefined),
    addToDataset: vi.fn().mockResolvedValue(undefined),
    enqueueCadence: vi.fn().mockResolvedValue(undefined),
    emailHourlyCap: cap,
    consumeEmailCapSlot: (args: {
      projectId: string;
      triggerId: string;
      now: Date;
      dedupKey: string;
    }) => consumeEmailCapSlot({ ...args, cap }),
    // The per-project daily cap (ADR-031) isn't the focus here (the per-trigger
    // hourly cap is) — wire a high ceiling and a pass-through that always
    // allows, so the daily backstop never bites these flows.
    tenantDailyCap: 1_000_000,
    consumeTenantEmailCapSlot: async () => ({ allowed: true, count: 0 }),
    // Suppression isn't the focus here (the cap is) — pass recipients through.
    filterSuppressedEmails: async ({ emails }: { emails: string[] }) => emails,
  };
}

function cadencePayload(
  triggerId: string,
  traceId: string,
  input = "what is the weather?",
  output = "it is sunny",
): CadenceStagePayload {
  return {
    stage: "cadence",
    projectId,
    triggerId,
    reactorName: TRIGGER_NOTIFY_REACTOR_NAME,
    auditDedupKey: auditDedupKey({ projectId, triggerId, traceId }),
    match: { traceId, input, output },
  };
}

interface TriggerInput {
  action: TriggerAction;
  actionParams: Record<string, unknown>;
  name?: string;
  emailBodyTemplate?: string | null;
  slackTemplate?: string | null;
  slackTemplateType?: string | null;
}

async function createTrigger(input: TriggerInput): Promise<string> {
  const id = `test-trigger-${generate(KSUID_RESOURCES.PROJECT)}`;
  await prisma.trigger.create({
    data: {
      id,
      name: input.name ?? "Full-flow alert",
      projectId,
      action: input.action,
      actionParams: input.actionParams as any,
      // Repo parses `filters` with JSON.parse — store a JSON string.
      filters: JSON.stringify({}),
      alertType: "WARNING",
      message: "Condition met",
      notificationCadence: "immediate",
      traceDebounceMs: 30000,
      emailBodyTemplate: input.emailBodyTemplate ?? null,
      slackTemplate: input.slackTemplate ?? null,
      slackTemplateType: input.slackTemplateType ?? null,
    },
  });
  // getActiveTraceTriggersForProject caches per project; bust it.
  await triggers.invalidate(projectId);
  return id;
}

/** A minimal trace with one span — enough for ADD_TO_DATASET mapping. */
function makeTrace(traceId: string): Trace {
  return {
    trace_id: traceId,
    project_id: projectId,
    metadata: {},
    timestamps: { started_at: Date.now(), inserted_at: Date.now() },
    input: { value: "what is the weather?" },
    output: { value: "it is sunny" },
    metrics: {},
    spans: [
      {
        span_id: "span-1",
        trace_id: traceId,
        project_id: projectId,
        type: "llm",
        name: "llm-call",
        input: { type: "text", value: "what is the weather?" },
        output: { type: "text", value: "it is sunny" },
        timestamps: {
          started_at: Date.now(),
          finished_at: Date.now(),
          inserted_at: Date.now(),
        },
      },
    ],
  } as unknown as Trace;
}

function makeFoldState(traceId: string): TraceSummaryData {
  return {
    traceId,
    spanCount: 1,
    totalDurationMs: 100,
    computedIOSchemaVersion: "1",
    computedInput: "what is the weather?",
    computedOutput: "it is sunny",
    timeToFirstTokenMs: null,
    timeToLastTokenMs: null,
    tokensPerSecond: null,
    containsErrorStatus: false,
    containsOKStatus: true,
    errorMessage: null,
    models: [],
    totalCost: null,
    tokensEstimated: false,
    totalPromptTokenCount: null,
    totalCompletionTokenCount: null,
    outputFromRootSpan: false,
    outputSpanEndTimeMs: 0,
    blockedByGuardrail: false,
    topicId: null,
    subTopicId: null,
    annotationIds: [],
    occurredAt: Date.now(),
    createdAt: Date.now(),
    updatedAt: Date.now(),
    LastEventOccurredAt: Date.now(),
    attributes: { "langwatch.origin": "application" },
  } as unknown as TraceSummaryData;
}

beforeAll(async () => {
  projectId = (await getTestProject(PROJECT_NAMESPACE)).id;
  userId = (await getTestUser()).id;
}, 60000);

beforeEach(() => {
  vi.clearAllMocks();
  _resetMemoryEmailCapStore();
});

afterEach(async () => {
  await prisma.triggerSent.deleteMany({ where: { projectId } });
  await prisma.trigger.deleteMany({ where: { projectId } });
});

afterAll(async () => {
  // Project / org / team are reused fixtures — leave them. Clean our rows.
  await prisma.annotationQueueItem.deleteMany({ where: { projectId } });
  await prisma.annotationQueue.deleteMany({ where: { projectId } });
  await prisma.datasetRecord.deleteMany({ where: { projectId } });
  await prisma.dataset.deleteMany({ where: { projectId } });
  await prisma.triggerSent.deleteMany({ where: { projectId } });
  await prisma.trigger.deleteMany({ where: { projectId } });
});

describe("trigger dispatch — full flow per action type", () => {
  describe("SEND_SLACK_MESSAGE (notify, outbox)", () => {
    it("hits the (mocked) Slack webhook with the trace input/output", async () => {
      const triggerId = await createTrigger({
        action: TriggerAction.SEND_SLACK_MESSAGE,
        actionParams: { slackWebhook: SLACK_WEBHOOK },
      });

      await createOutboxDispatcher(makeNotifyDeps()).process(
        cadencePayload(triggerId, "trace-slack-1"),
      );

      expect(slackSendMock).toHaveBeenCalledTimes(1);
      const message = JSON.stringify(slackSendMock.mock.calls[0]![0]);
      // The default Slack format carries the trigger identity + a deep link to
      // the matched trace (raw input/output only render when there's no
      // operator message; this trigger has one).
      expect(message).toContain("Full-flow alert");
      expect(message).toContain("trace-slack-1");
    });

    it("renders a custom Slack template into the delivered message", async () => {
      const triggerId = await createTrigger({
        action: TriggerAction.SEND_SLACK_MESSAGE,
        name: "Latency alert",
        actionParams: { slackWebhook: SLACK_WEBHOOK },
        slackTemplateType: "string",
        slackTemplate: "Hello {{ trigger.name }} — {{ matches.size }} match",
      });

      await createOutboxDispatcher(makeNotifyDeps()).process(
        cadencePayload(triggerId, "trace-slack-2"),
      );

      expect(slackSendMock).toHaveBeenCalledTimes(1);
      const message = JSON.stringify(slackSendMock.mock.calls[0]![0]);
      expect(message).toContain("Latency alert");
      expect(message).toContain("1 match");
    });
  });

  describe("SEND_EMAIL (notify, outbox)", () => {
    it("delivers an email to the configured recipient", async () => {
      const triggerId = await createTrigger({
        action: TriggerAction.SEND_EMAIL,
        actionParams: { members: ["ops@example.com"] },
      });

      await createOutboxDispatcher(makeNotifyDeps()).process(
        cadencePayload(triggerId, "trace-email-1"),
      );

      expect(emailSendMock).toHaveBeenCalledTimes(1);
      const envelope = emailSendMock.mock.calls[0]![0];
      // Trigger emails send from a no-reply From with each recipient bcc'd
      // (recipients never see each other).
      expect(envelope.bcc).toContain("ops@example.com");
      expect(typeof envelope.subject).toBe("string");
      expect(envelope.html.length).toBeGreaterThan(0);
    });

    it("renders a custom email template into the delivered html", async () => {
      const triggerId = await createTrigger({
        action: TriggerAction.SEND_EMAIL,
        name: "Latency alert",
        actionParams: { members: ["ops@example.com"] },
        emailBodyTemplate:
          "Hello {{ trigger.name }} — {{ matches.size }} match",
      });

      await createOutboxDispatcher(makeNotifyDeps()).process(
        cadencePayload(triggerId, "trace-email-2"),
      );

      expect(emailSendMock).toHaveBeenCalledTimes(1);
      const envelope = emailSendMock.mock.calls[0]![0];
      expect(envelope.html).toContain("Latency alert");
      expect(envelope.html).toContain("1 match");
    });

    describe("per-trigger hourly email cap (ADR-031 safeguard)", () => {
      it("delivers up to the cap and drops the rest without throwing", async () => {
        const triggerId = await createTrigger({
          action: TriggerAction.SEND_EMAIL,
          actionParams: { members: ["ops@example.com"] },
        });
        const dispatcher = createOutboxDispatcher(
          makeNotifyDeps({ emailCap: 2 }),
        );

        // Three distinct traces (distinct claim keys) → three dispatch attempts.
        for (const n of [1, 2, 3]) {
          await expect(
            dispatcher.process(cadencePayload(triggerId, `trace-cap-${n}`)),
          ).resolves.toBeUndefined();
        }

        // Cap = 2 → exactly two delivered, the third dropped silently.
        expect(emailSendMock).toHaveBeenCalledTimes(2);
      });
    });
  });

  describe("ADD_TO_ANNOTATION_QUEUE (persist, inline)", () => {
    it("creates a real annotation-queue item for the trace", async () => {
      const queue = await prisma.annotationQueue.create({
        data: {
          name: "Triage queue",
          slug: `triage-${generate(KSUID_RESOURCES.PROJECT)}`,
          projectId,
        },
      });
      const triggerId = await createTrigger({
        action: TriggerAction.ADD_TO_ANNOTATION_QUEUE,
        actionParams: {
          annotators: [{ id: `queue-${queue.id}`, name: "Triage queue" }],
          createdByUserId: userId,
        },
      });
      const trigger = (
        await triggers.getActiveTraceTriggersForProject(projectId)
      ).find((t) => t.id === triggerId)!;
      const traceId = "trace-annotation-1";

      await dispatchTriggerAction({
        deps: {
          triggers: triggers as any,
          projects: projects as any,
          traceById: async () => undefined,
          addToAnnotationQueue: (params: any) =>
            createOrUpdateQueueItems({ ...params, prisma }),
          addToDataset: async () => {},
        } as any,
        trigger,
        traceId,
        tenantId: projectId,
        foldState: makeFoldState(traceId),
      });

      const item = await prisma.annotationQueueItem.findFirst({
        where: { traceId, annotationQueueId: queue.id, projectId },
      });
      expect(item).not.toBeNull();
      expect(item?.createdByUserId).toBe(userId);
    });
  });

  describe("ADD_TO_DATASET (persist, inline)", () => {
    it("creates a real dataset record from the trace", async () => {
      const dataset = await prisma.dataset.create({
        data: {
          name: "Triggered traces",
          slug: `triggered-${generate(KSUID_RESOURCES.PROJECT)}`,
          projectId,
          useS3: false,
          columnTypes: [
            { name: "input", type: "string" },
            { name: "output", type: "string" },
          ] as any,
        },
      });
      const triggerId = await createTrigger({
        action: TriggerAction.ADD_TO_DATASET,
        actionParams: {
          datasetId: dataset.id,
          datasetMapping: {
            mapping: {
              input: { source: "input" },
              output: { source: "output" },
            },
            expansions: [],
          },
        },
      });
      const trigger = (
        await triggers.getActiveTraceTriggersForProject(projectId)
      ).find((t) => t.id === triggerId)!;
      const traceId = "trace-dataset-1";

      await dispatchTriggerAction({
        deps: {
          triggers: triggers as any,
          projects: projects as any,
          traceById: async () => makeTrace(traceId),
          addToAnnotationQueue: async () => {},
          addToDataset: (params: any) => createManyDatasetRecords(params),
        } as any,
        trigger,
        traceId,
        tenantId: projectId,
        foldState: makeFoldState(traceId),
      });

      const records = await prisma.datasetRecord.findMany({
        where: { datasetId: dataset.id, projectId },
      });
      expect(records.length).toBeGreaterThan(0);
    });
  });

  describe("settle → cadence → delivery (whole outbox flow)", () => {
    it("re-reads the settled trace, enqueues a cadence dispatch, and delivers it", async () => {
      const triggerId = await createTrigger({
        action: TriggerAction.SEND_SLACK_MESSAGE,
        actionParams: { slackWebhook: SLACK_WEBHOOK },
      });
      const deps = makeNotifyDeps();
      // The settle stage re-reads the trace fold (ClickHouse-backed in prod).
      deps.traceSummaryStore.get = vi
        .fn()
        .mockResolvedValue(makeFoldState("trace-settle-1"));
      const dispatcher = createOutboxDispatcher(deps);

      const settle: SettleStagePayload = {
        stage: "settle",
        projectId,
        triggerId,
        traceId: "trace-settle-1",
        reactorName: TRIGGER_NOTIFY_REACTOR_NAME,
        auditDedupKey: auditDedupKey({
          projectId,
          triggerId,
          traceId: "trace-settle-1",
        }),
        foldSnapshotAtEnqueue: {
          computedInput: "what is the weather?",
          computedOutput: "it is sunny",
        },
      };

      // Stage 1 — settle: trace went quiet, re-match, enqueue the digest.
      await dispatcher.process(settle);
      expect(deps.enqueueCadence).toHaveBeenCalledTimes(1);
      const enqueued = deps.enqueueCadence.mock
        .calls[0]![0] as CadenceStagePayload;
      expect(enqueued.stage).toBe("cadence");
      expect(enqueued.match.traceId).toBe("trace-settle-1");

      // Stage 2 — cadence: dispatch the enqueued digest → the webhook is hit.
      await dispatcher.process(enqueued);
      expect(slackSendMock).toHaveBeenCalledTimes(1);
    });
  });
});
