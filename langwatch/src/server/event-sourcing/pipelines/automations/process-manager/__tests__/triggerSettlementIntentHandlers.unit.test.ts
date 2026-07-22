import { TriggerAction, TriggerKind } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TraceSummaryData } from "~/server/app-layer/traces/types";
import type { TriggerSummary } from "@langwatch/automations/repositories/trigger.repository";
import type { IntentContext } from "~/server/event-sourcing/pipeline/processManagerDefinition";
import type { Trace } from "~/server/tracer/types";
import {
  appDatasetMapping,
  appSettledMatchKit,
} from "~/server/app-layer/automations/dispatch/appDispatchPorts";
import {
  createLogOverflowHandler,
  createNotifyDigestHandler,
  createPersistMatchHandler,
  type TriggerSettlementDispatchDeps,
} from "../triggerSettlementIntentHandlers";

const { deliverWebhookMock, loggerWarnMock, sendRenderedTriggerEmailMock } =
  vi.hoisted(() => ({
    deliverWebhookMock: vi.fn().mockResolvedValue(undefined),
    loggerWarnMock: vi.fn(),
    sendRenderedTriggerEmailMock: vi.fn().mockResolvedValue(undefined),
  }));

vi.mock("@langwatch/automations-server/clients/http/deliver-webhook", () => ({
  deliverWebhook: deliverWebhookMock,
}));
vi.mock("~/server/app-layer/automations/delivery/appWebhookSender", () => ({
  sendWebhook: vi.fn(),
}));

vi.mock("~/server/mailer/triggerEmail", () => ({
  sendRenderedTriggerEmail: sendRenderedTriggerEmailMock,
  sendTriggerEmail: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@langwatch/observability", () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: loggerWarnMock,
    error: vi.fn(),
  }),
}));

function fold(
  traceId: string,
  overrides: Partial<TraceSummaryData> = {},
): TraceSummaryData {
  return {
    traceId,
    spanCount: 1,
    computedInput: `input:${traceId}`,
    computedOutput: `output:${traceId}`,
    blockedByGuardrail: false,
    occurredAt: Date.now(),
    models: [],
    annotationIds: [],
    attributes: { "langwatch.origin": "application" },
    ...overrides,
  } as TraceSummaryData;
}

function fullTrace(traceId: string): Trace {
  const now = Date.now();
  return {
    trace_id: traceId,
    project_id: "project-1",
    metadata: { environment: "test" },
    timestamps: {
      started_at: now,
      inserted_at: now,
      updated_at: now,
    },
    spans: [
      {
        span_id: "span-1",
        trace_id: traceId,
        type: "llm",
        name: "call",
        input: { type: "text", value: `input:${traceId}` },
        output: { type: "text", value: `output:${traceId}` },
        timestamps: {
          started_at: now,
          finished_at: now,
        },
      },
    ],
  };
}

function trigger(
  action: TriggerAction,
  overrides: Partial<TriggerSummary> = {},
): TriggerSummary {
  return {
    id: "trigger-1",
    projectId: "project-1",
    name: "Dispatch integration",
    action,
    triggerKind: TriggerKind.AUTOMATION,
    actionParams: {},
    filters: {},
    alertType: "WARNING",
    message: "",
    customGraphId: null,
    notificationCadence: "immediate",
    filterQuery: null,
    traceDebounceMs: 0,
    templates: {
      slackTemplateType: null,
      slackTemplate: null,
      emailSubjectTemplate: null,
      emailBodyTemplate: null,
    },
    ...overrides,
  };
}

function context(
  messageKey = "process:trigger-1:digest:1000:batch",
): IntentContext {
  return {
    processName: "triggerSettlement",
    projectId: "project-1",
    processKey: "trigger-1",
    tenantId: "project-1",
    messageKey,
    attempt: 1,
  };
}

function makeDeps(activeTrigger: TriggerSummary) {
  const folds = new Map([
    ["trace-1", fold("trace-1")],
    ["trace-2", fold("trace-2")],
  ]);
  const triggers = {
    getActiveTraceTriggersForProject: vi
      .fn()
      .mockResolvedValue([activeTrigger]),
    isSendClaimed: vi.fn().mockResolvedValue(false),
    claimSend: vi.fn().mockResolvedValue(undefined),
    updateLastRunAt: vi.fn().mockResolvedValue(undefined),
  };
  const deps = {
    filters: appSettledMatchKit,
    datasetMapping: appDatasetMapping,
    triggers,
    projects: {
      getById: vi.fn().mockResolvedValue({
        id: "project-1",
        name: "Test project",
        slug: "test-project",
      }),
    },
    baseHost: "https://app.example.com",
    traceSummaryStore: {
      get: vi.fn(async (traceId: string) => folds.get(traceId) ?? null),
      store: vi.fn(),
    },
    evaluationRuns: { findByTraceId: vi.fn().mockResolvedValue([]) },
    deriveEvents: vi.fn().mockResolvedValue([]),
    traceById: vi.fn(async (_projectId: string, traceId: string) =>
      fullTrace(traceId),
    ),
    addToAnnotationQueue: vi.fn().mockResolvedValue(undefined),
    addToDataset: vi.fn().mockResolvedValue(undefined),
    consumeEmailCapSlot: vi.fn().mockResolvedValue({ allowed: true, count: 1 }),
    emailHourlyCap: 100,
    consumeTenantEmailCapSlot: vi
      .fn()
      .mockResolvedValue({ allowed: true, count: 1 }),
    tenantDailyCap: 1_000,
    filterSuppressedEmails: vi.fn(async ({ emails }) => emails),
  };
  return {
    deps: deps as unknown as TriggerSettlementDispatchDeps,
    triggers,
    folds,
    raw: deps,
  };
}

describe("trigger settlement intent handlers integration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("given the pending-match bound flushed old entries", () => {
    it("logs the committed flush count from an effectful intent", async () => {
      await createLogOverflowHandler()(
        { triggerId: "trigger-1", flushed: 2, totalFlushed: 7 },
        context("overflow:7"),
      );

      expect(loggerWarnMock).toHaveBeenCalledWith(
        {
          projectId: "project-1",
          triggerId: "trigger-1",
          flushed: 2,
          totalFlushed: 7,
        },
        "Trigger settlement pending-match bound flushed oldest matches to immediate dispatch",
      );
    });
  });

  describe("given a notify digest with passing, failing, and claimed traces", () => {
    it("confirms, renders, sends, claims only candidates, and drops the rest", async () => {
      const activeTrigger = trigger(TriggerAction.SEND_EMAIL, {
        actionParams: { members: ["ops@example.com"] },
        filters: { "traces.origin": ["application"] },
        templates: {
          slackTemplateType: null,
          slackTemplate: null,
          emailSubjectTemplate: "Alert: {{ trigger.name }}",
          emailBodyTemplate: "Matched {{ matches.size }} trace",
        },
      });
      const { deps, triggers, folds } = makeDeps(activeTrigger);
      folds.set(
        "trace-filtered",
        fold("trace-filtered", {
          attributes: { "langwatch.origin": "evaluation" },
        }),
      );
      folds.set("trace-claimed", fold("trace-claimed"));
      triggers.isSendClaimed.mockImplementation(
        async ({ traceId }) => traceId === "trace-claimed",
      );

      await createNotifyDigestHandler(deps)(
        {
          triggerId: "trigger-1",
          traceIds: ["trace-1", "trace-filtered", "trace-claimed"],
          boundary: 1_000,
        },
        context(),
      );

      expect(sendRenderedTriggerEmailMock).toHaveBeenCalledTimes(1);
      expect(sendRenderedTriggerEmailMock).toHaveBeenCalledWith(
        expect.objectContaining({
          triggerEmails: ["ops@example.com"],
          subject: "Alert: Dispatch integration",
          html: expect.stringContaining("Matched 1 trace"),
        }),
      );
      expect(triggers.claimSend).toHaveBeenCalledTimes(1);
      expect(triggers.claimSend).toHaveBeenCalledWith({
        triggerId: "trigger-1",
        traceId: "trace-1",
        projectId: "project-1",
      });
      expect(triggers.updateLastRunAt).toHaveBeenCalledWith(
        "trigger-1",
        "project-1",
      );
    });
  });

  describe("given two triggers share an identical candidate trace set", () => {
    it("keys the tenant daily cap slot on triggerId so each trigger's recipients count", async () => {
      const emailTemplates = {
        slackTemplateType: null,
        slackTemplate: null,
        emailSubjectTemplate: "Alert: {{ trigger.name }}",
        emailBodyTemplate: "Matched {{ matches.size }} trace",
      };
      const triggerA = trigger(TriggerAction.SEND_EMAIL, {
        id: "trigger-a",
        actionParams: { members: ["ops@example.com"] },
        templates: emailTemplates,
      });
      const { deps, raw } = makeDeps(triggerA);
      raw.triggers.getActiveTraceTriggersForProject.mockImplementation(
        async () => [
          triggerA,
          trigger(TriggerAction.SEND_EMAIL, {
            id: "trigger-b",
            actionParams: { members: ["ops@example.com"] },
            templates: emailTemplates,
          }),
        ],
      );

      const digestPayload = (triggerId: string) => ({
        triggerId,
        traceIds: ["trace-1"],
        boundary: 1_000,
      });
      const handler = createNotifyDigestHandler(deps);

      await handler(
        digestPayload("trigger-a"),
        context("process:trigger-a:digest:1000:batch"),
      );
      await handler(
        digestPayload("trigger-b"),
        context("process:trigger-b:digest:1000:batch"),
      );

      const tenantDedupKeys = raw.consumeTenantEmailCapSlot.mock.calls.map(
        (call) => (call[0] as { dedupKey: string }).dedupKey,
      );
      expect(tenantDedupKeys).toHaveLength(2);
      expect(tenantDedupKeys[0]).toContain("trigger-a");
      expect(tenantDedupKeys[1]).toContain("trigger-b");
      // The two dispatches share the same trace set (same digest) yet must
      // not collide on the tenant daily-cap claim — the ADR-031 backstop
      // counts each trigger's recipients only if the keys differ.
      expect(tenantDedupKeys[0]).not.toBe(tenantDedupKeys[1]);
    });
  });

  describe("given a notify trace was sent in an earlier settle window", () => {
    it("uses the send claim to suppress a duplicate across windows", async () => {
      const activeTrigger = trigger(TriggerAction.SEND_EMAIL, {
        actionParams: { members: ["ops@example.com"] },
        templates: {
          slackTemplateType: null,
          slackTemplate: null,
          emailSubjectTemplate: "Alert: {{ trigger.name }}",
          emailBodyTemplate: "Matched {{ matches.size }} trace",
        },
      });
      const { deps, triggers } = makeDeps(activeTrigger);
      const claimed = new Set<string>();
      triggers.isSendClaimed.mockImplementation(async ({ traceId }) =>
        claimed.has(traceId),
      );
      triggers.claimSend.mockImplementation(async ({ traceId }) => {
        claimed.add(traceId);
      });
      const handler = createNotifyDigestHandler(deps);

      await handler(
        {
          triggerId: "trigger-1",
          traceIds: ["trace-1"],
          boundary: 31_000,
        },
        context("process:trigger-1:digest:31000:first-window"),
      );
      await handler(
        {
          triggerId: "trigger-1",
          traceIds: ["trace-1"],
          boundary: 61_000,
        },
        context("process:trigger-1:digest:61000:second-window"),
      );

      expect(sendRenderedTriggerEmailMock).toHaveBeenCalledTimes(1);
      expect(triggers.claimSend).toHaveBeenCalledTimes(1);
    });
  });

  describe("given a persist-match intent", () => {
    it("confirms the settled trace, writes the dataset, then claims the match", async () => {
      const activeTrigger = trigger(TriggerAction.ADD_TO_DATASET, {
        actionParams: {
          datasetId: "dataset-1",
          datasetMapping: { mapping: {}, expansions: [] },
        },
      });
      const { deps, triggers, raw } = makeDeps(activeTrigger);

      await createPersistMatchHandler(deps)(
        { triggerId: "trigger-1", traceId: "trace-1" },
        context("process:trigger-1:persist:trace-1"),
      );

      expect(raw.addToDataset).toHaveBeenCalledWith(
        expect.objectContaining({
          datasetId: "dataset-1",
          projectId: "project-1",
        }),
      );
      expect(triggers.claimSend).toHaveBeenCalledWith({
        triggerId: "trigger-1",
        traceId: "trace-1",
        projectId: "project-1",
      });
    });
  });

  describe("given a persist trace only passes filters after later activity", () => {
    it("runs the persist action during the later settle window", async () => {
      const activeTrigger = trigger(TriggerAction.ADD_TO_DATASET, {
        actionParams: {
          datasetId: "dataset-1",
          datasetMapping: { mapping: {}, expansions: [] },
        },
        filters: { "traces.origin": ["application"] },
      });
      const { deps, triggers, folds, raw } = makeDeps(activeTrigger);
      folds.set(
        "trace-1",
        fold("trace-1", {
          attributes: { "langwatch.origin": "evaluation" },
        }),
      );
      const handler = createPersistMatchHandler(deps);

      await handler(
        { triggerId: "trigger-1", traceId: "trace-1" },
        context("process:trigger-1:persist:trace-1:30000-0"),
      );
      folds.set("trace-1", fold("trace-1"));
      await handler(
        { triggerId: "trigger-1", traceId: "trace-1" },
        context("process:trigger-1:persist:trace-1:30000-1"),
      );

      expect(raw.addToDataset).toHaveBeenCalledTimes(1);
      expect(triggers.claimSend).toHaveBeenCalledTimes(1);
    });
  });

  describe("given a webhook retry after one trace was already claimed", () => {
    it("keeps X-LangWatch-Event-Id stable from the outbox message key", async () => {
      const activeTrigger = trigger(TriggerAction.SEND_WEBHOOK, {
        actionParams: {
          url: "https://example.com/hook",
          method: "POST",
          bodyTemplate: '{"count": {{ matches.size }}}',
        },
      });
      const { deps, triggers } = makeDeps(activeTrigger);
      const handler = createNotifyDigestHandler(deps);
      const payload = {
        triggerId: "trigger-1",
        traceIds: ["trace-1", "trace-2"],
        boundary: 1_000,
      };
      const intentContext = context(
        "process:trigger-1:digest:1000:stable-batch",
      );

      await handler(payload, intentContext);
      triggers.isSendClaimed.mockImplementation(
        async ({ traceId }) => traceId === "trace-1",
      );
      await handler(payload, { ...intentContext, attempt: 2 });

      expect(deliverWebhookMock).toHaveBeenCalledTimes(2);
      expect(deliverWebhookMock.mock.calls[0]![0].eventId).toBe(
        deliverWebhookMock.mock.calls[1]![0].eventId,
      );
    });
  });
});
