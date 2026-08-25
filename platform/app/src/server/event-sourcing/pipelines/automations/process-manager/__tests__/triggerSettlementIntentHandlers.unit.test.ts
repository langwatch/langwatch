import type { IntentContext } from "@langwatch/eventing";
import { DispatchError, isDispatchError } from "@langwatch/eventing";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TriggerAction, TriggerKind } from "~/generated/prisma/client";
import type { TriggerSummary } from "~/server/app-layer/automations/trigger-summary";
import type { TraceSummaryData } from "~/server/app-layer/traces/types";
import type { Trace } from "~/server/tracer/types";
import {
  createLogOverflowHandler,
  createNotifyDigestHandler,
  createPersistMatchHandler,
  type TriggerSettlementDispatchDeps,
} from "../triggerSettlementIntentHandlers";

const { deliverWebhookMock, loggerWarnMock, sendRenderedTriggerEmailMock } = vi.hoisted(
  () => ({
    deliverWebhookMock: vi.fn().mockResolvedValue(undefined),
    loggerWarnMock: vi.fn(),
    sendRenderedTriggerEmailMock: vi.fn().mockResolvedValue(undefined),
  }),
);

vi.mock("~/server/app-layer/automations/delivery/deliverWebhook", () => ({
  deliverWebhook: deliverWebhookMock,
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

function context(messageKey = "process:trigger-1:digest:1000:batch"): IntentContext {
  return {
    processName: "triggerSettlement",
    projectId: "project-1",
    processKey: "trigger-1",
    tenantId: "project-1",
    messageKey,
    attempt: 1,
  };
}

/** The ceiling `resolvePersistDailyCap` reports in these fixtures. */
const PERSIST_DAILY_CAP = 100;

function makeDeps(activeTrigger: TriggerSummary) {
  const folds = new Map([
    ["trace-1", fold("trace-1")],
    ["trace-2", fold("trace-2")],
  ]);
  const triggers = {
    getActiveTraceTriggersForProject: vi.fn().mockResolvedValue([activeTrigger]),
    isSendClaimed: vi.fn().mockResolvedValue(false),
    filterSendClaimed: vi.fn().mockResolvedValue(new Set<string>()),
    claimSend: vi.fn().mockResolvedValue(undefined),
    updateLastRunAt: vi.fn().mockResolvedValue(undefined),
  };
  const deps = {
    automation: triggers,
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
    traceById: vi.fn(async (_projectId: string, traceId: string) => fullTrace(traceId)),
    addToAnnotationQueue: vi.fn().mockResolvedValue(undefined),
    addToDataset: vi.fn().mockResolvedValue(undefined),
    consumeEmailCapSlot: vi.fn().mockResolvedValue({ allowed: true, count: 1 }),
    emailHourlyCap: 100,
    consumeTenantEmailCapSlot: vi.fn().mockResolvedValue({ allowed: true, count: 1 }),
    tenantDailyCap: 1_000,
    filterSuppressedEmails: vi.fn(async ({ emails }) => emails),
    resolvePersistDailyCap: vi.fn().mockResolvedValue(PERSIST_DAILY_CAP),
    consumePersistCapSlot: vi.fn().mockResolvedValue({
      allowed: true,
      count: 1,
      cap: PERSIST_DAILY_CAP,
      skipped: 0,
    }),
    handlePersistCapBreach: vi.fn().mockResolvedValue(undefined),
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
      expect(triggers.updateLastRunAt).toHaveBeenCalledWith("trigger-1", "project-1");
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
      raw.automation.getActiveTraceTriggersForProject.mockImplementation(async () => [
        triggerA,
        trigger(TriggerAction.SEND_EMAIL, {
          id: "trigger-b",
          actionParams: { members: ["ops@example.com"] },
          templates: emailTemplates,
        }),
      ]);

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
    /** @scenario "An old single-trace persist intent still dispatches after the paging change" */
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

  // The ceiling only ever counts CUSTOMER-ATTRIBUTABLE volume: a confirmed
  // match that was about to create a dataset row or an annotation item. Where
  // it sits in the dispatch is what makes that true, so these pin the position
  // rather than the arithmetic (which persistCap.unit.test.ts owns).
  describe("given the daily match ceiling", () => {
    const datasetTrigger = () =>
      trigger(TriggerAction.ADD_TO_DATASET, {
        actionParams: {
          datasetId: "dataset-1",
          datasetMapping: { mapping: {}, expansions: [] },
        },
      });

    /** @scenario "A confirmed persist dispatch consumes a ceiling slot" */
    it("consumes one slot for a match that is about to create a record", async () => {
      const { deps, raw } = makeDeps(datasetTrigger());

      await createPersistMatchHandler(deps)(
        { triggerId: "trigger-1", traceId: "trace-1" },
        context("process:trigger-1:persist:trace-1"),
      );

      expect(raw.consumePersistCapSlot).toHaveBeenCalledTimes(1);
      expect(raw.consumePersistCapSlot).toHaveBeenCalledWith(
        expect.objectContaining({
          projectId: "project-1",
          triggerId: "trigger-1",
          // The RESOLVED cap, not a hardcoded one. Without pinning this, a
          // wiring bug that passed a stale or default ceiling to the counter
          // would keep the test green while throttling customers at the wrong
          // number.
          cap: PERSIST_DAILY_CAP,
          // The (trigger, trace) pair, so an outbox retry of this dispatch
          // presents the same key and cannot burn a second slot.
          dedupKey: "project-1/trigger-1:persist:trace-1",
        }),
      );
      expect(raw.addToDataset).toHaveBeenCalledTimes(1);
    });

    /** @scenario "A match that fails its filters at dispatch consumes nothing" */
    it("consumes nothing when the filters no longer pass", async () => {
      const activeTrigger = trigger(TriggerAction.ADD_TO_DATASET, {
        actionParams: {
          datasetId: "dataset-1",
          datasetMapping: { mapping: {}, expansions: [] },
        },
        filters: { "traces.origin": ["application"] },
      });
      const { deps, folds, raw } = makeDeps(activeTrigger);
      folds.set(
        "trace-1",
        fold("trace-1", { attributes: { "langwatch.origin": "evaluation" } }),
      );

      await createPersistMatchHandler(deps)(
        { triggerId: "trigger-1", traceId: "trace-1" },
        context("process:trigger-1:persist:trace-1"),
      );

      expect(raw.consumePersistCapSlot).not.toHaveBeenCalled();
      expect(raw.addToDataset).not.toHaveBeenCalled();
    });

    /** @scenario "A dispatch over the ceiling is dropped without an error" */
    it("drops the match terminally instead of throwing for a retry", async () => {
      const { deps, raw, triggers } = makeDeps(datasetTrigger());
      raw.consumePersistCapSlot.mockResolvedValue({
        allowed: false,
        count: 101,
        cap: 100,
        skipped: 1,
      });

      await expect(
        createPersistMatchHandler(deps)(
          { triggerId: "trigger-1", traceId: "trace-1" },
          context("process:trigger-1:persist:trace-1"),
        ),
      ).resolves.toBeUndefined();

      expect(raw.addToDataset).not.toHaveBeenCalled();
      // No claim either: the match was never acted on, so nothing happened
      // that a future dispatch of the same pair should be suppressed against.
      expect(triggers.claimSend).not.toHaveBeenCalled();
      expect(raw.handlePersistCapBreach).toHaveBeenCalledWith(
        expect.objectContaining({ count: 101, cap: 100, skipped: 1 }),
      );
    });

    /** @scenario "A containment failure never breaks the dispatch it was watching" */
    it("does not retry the dispatch when containment itself fails", async () => {
      // Containment is bookkeeping about a match that was already dropped.
      // Letting it throw would make the outbox replay a dispatch whose only
      // remaining work is the bookkeeping that just failed.
      const { deps, raw } = makeDeps(datasetTrigger());
      raw.consumePersistCapSlot.mockResolvedValue({
        allowed: false,
        count: 101,
        cap: 100,
        skipped: 1,
      });
      raw.handlePersistCapBreach.mockRejectedValue(new Error("mailer down"));

      await expect(
        createPersistMatchHandler(deps)(
          { triggerId: "trigger-1", traceId: "trace-1" },
          context("process:trigger-1:persist:trace-1"),
        ),
      ).resolves.toBeUndefined();
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

  describe("given a paged persist-match intent", () => {
    const datasetTrigger = () =>
      trigger(TriggerAction.ADD_TO_DATASET, {
        actionParams: {
          datasetId: "dataset-1",
          datasetMapping: { mapping: {}, expansions: [] },
        },
      });

    /** @scenario "Settled persist matches dispatch in bounded pages" */
    it("dispatches every trace of the page and re-runs only unclaimed traces on a retry", async () => {
      const { deps, triggers, raw } = makeDeps(datasetTrigger());
      const handler = createPersistMatchHandler(deps);
      const payload = {
        triggerId: "trigger-1",
        traceIds: ["trace-1", "trace-2"],
      };

      await handler(payload, context("process:trigger-1:persist:page-1"));

      expect(raw.addToDataset).toHaveBeenCalledTimes(2);
      expect(triggers.claimSend).toHaveBeenCalledTimes(2);
      // The fixed per-dispatch reads are paid once per page, not per trace.
      expect(triggers.getActiveTraceTriggersForProject).toHaveBeenCalledTimes(1);
      expect(raw.resolvePersistDailyCap).toHaveBeenCalledTimes(1);
      expect(raw.projects.tryGetById).toHaveBeenCalledTimes(1);
      expect(triggers.filterSendClaimed).toHaveBeenCalledWith({
        triggerId: "trigger-1",
        traceIds: ["trace-1", "trace-2"],
        projectId: "project-1",
      });

      // The retry presents the same page; the claim filter suppresses the
      // trace that already dispatched.
      triggers.filterSendClaimed.mockResolvedValue(new Set(["trace-1"]));
      await handler(payload, {
        ...context("process:trigger-1:persist:page-1"),
        attempt: 2,
      });

      expect(raw.addToDataset).toHaveBeenCalledTimes(3);
      const retriedClaims = triggers.claimSend.mock.calls.slice(2);
      expect(retriedClaims).toEqual([
        [
          {
            triggerId: "trigger-1",
            traceId: "trace-2",
            projectId: "project-1",
          },
        ],
      ]);
    });

    /** @scenario "A terminal failure for one trace does not fail its page-mates" */
    it("records a non-retryable trace failure and still dispatches the rest", async () => {
      const { deps, triggers, raw } = makeDeps(datasetTrigger());
      raw.addToDataset.mockImplementation(
        async ({ datasetRecords }: { datasetRecords: { id: string }[] }) => {
          if (datasetRecords[0]!.id.includes("trace-1")) {
            throw new DispatchError({
              message: "dataset gone",
              retryable: false,
            });
          }
        },
      );

      await expect(
        createPersistMatchHandler(deps)(
          { triggerId: "trigger-1", traceIds: ["trace-1", "trace-2"] },
          context("process:trigger-1:persist:page-1"),
        ),
      ).resolves.toBeUndefined();

      expect(triggers.claimSend).toHaveBeenCalledTimes(1);
      expect(triggers.claimSend).toHaveBeenCalledWith({
        triggerId: "trigger-1",
        traceId: "trace-2",
        projectId: "project-1",
      });
    });

    it("retries the whole page once when a trace fails retryably, after the others ran", async () => {
      const { deps, triggers, raw } = makeDeps(datasetTrigger());
      raw.addToDataset.mockImplementation(
        async ({ datasetRecords }: { datasetRecords: { id: string }[] }) => {
          if (datasetRecords[0]!.id.includes("trace-1")) {
            throw new DispatchError({
              message: "database unavailable",
              retryable: true,
            });
          }
        },
      );

      const thrown = await createPersistMatchHandler(deps)(
        { triggerId: "trigger-1", traceIds: ["trace-1", "trace-2"] },
        context("process:trigger-1:persist:page-1"),
      ).catch((error: unknown) => error);

      // The classification, not the copy, is what the outbox acts on.
      expect(isDispatchError(thrown)).toBe(true);
      expect((thrown as DispatchError).retryable).toBe(true);

      // The page-mate was not abandoned by the failure: it dispatched and
      // claimed, so the outbox retry of the page re-runs only trace-1.
      expect(triggers.claimSend).toHaveBeenCalledWith({
        triggerId: "trigger-1",
        traceId: "trace-2",
        projectId: "project-1",
      });
    });

    it("treats an unclassified failure as retryable and retries the page", async () => {
      const { deps, raw } = makeDeps(datasetTrigger());
      raw.addToDataset.mockImplementation(
        async ({ datasetRecords }: { datasetRecords: { id: string }[] }) => {
          if (datasetRecords[0]!.id.includes("trace-1")) {
            throw new Error("connection reset");
          }
        },
      );

      const thrown = await createPersistMatchHandler(deps)(
        { triggerId: "trigger-1", traceIds: ["trace-1", "trace-2"] },
        context("process:trigger-1:persist:page-1"),
      ).catch((error: unknown) => error);

      expect(thrown).toBeInstanceOf(Error);
      expect(isDispatchError(thrown)).toBe(false);
    });

    /** @scenario "A retrying page names the failure that caused the retry" */
    it("names the failing error on the page retry record", async () => {
      const { deps, raw } = makeDeps(datasetTrigger());
      raw.addToDataset.mockRejectedValue(
        new DispatchError({
          message: "clickhouse read timed out",
          retryable: true,
        }),
      );

      await createPersistMatchHandler(deps)(
        { triggerId: "trigger-1", traceIds: ["trace-1"] },
        context("process:trigger-1:persist:page-1"),
      ).catch(() => undefined);

      expect(loggerWarnMock).toHaveBeenCalledWith(
        expect.objectContaining({
          projectId: "project-1",
          triggerId: "trigger-1",
          failed: 1,
          pageSize: 1,
          errorType: "DispatchError",
          errorMessage: "clickhouse read timed out",
        }),
        "Persist page had retryable failures. Retrying the page; claimed traces no-op on the retry",
      );
    });

    it("dispatches a repeated trace of a page only once", async () => {
      const { deps, triggers, raw } = makeDeps(datasetTrigger());

      await createPersistMatchHandler(deps)(
        { triggerId: "trigger-1", traceIds: ["trace-1", "trace-1"] },
        context("process:trigger-1:persist:page-1"),
      );

      expect(raw.addToDataset).toHaveBeenCalledTimes(1);
      expect(triggers.claimSend).toHaveBeenCalledTimes(1);
      expect(triggers.filterSendClaimed).toHaveBeenCalledWith({
        triggerId: "trigger-1",
        traceIds: ["trace-1"],
        projectId: "project-1",
      });
    });

    /** @scenario "A failed claim write does not cancel a page-mate's retry" */
    it("retries the page for the failed trace when a page-mate lost its claim write", async () => {
      const { deps, triggers, raw } = makeDeps(datasetTrigger());
      // trace-1 dispatches and then loses its claim write on every attempt;
      // trace-2 fails in a way that must retry the whole page.
      triggers.claimSend.mockRejectedValue(new Error("claim write failed"));
      raw.addToDataset.mockImplementation(
        async ({ datasetRecords }: { datasetRecords: { id: string }[] }) => {
          if (datasetRecords[0]!.id.includes("trace-2")) {
            throw new DispatchError({
              message: "database unavailable",
              retryable: true,
            });
          }
        },
      );

      // The retry runs trace-1 again, because no claim suppresses it. That
      // duplicate is accepted: dropping the retry would lose trace-2's
      // dataset row for good, and a settled trace has no next match.
      const thrown = await createPersistMatchHandler(deps)(
        { triggerId: "trigger-1", traceIds: ["trace-1", "trace-2"] },
        context("process:trigger-1:persist:page-1"),
      ).catch((error: unknown) => error);

      expect(isDispatchError(thrown)).toBe(true);
      expect((thrown as DispatchError).retryable).toBe(true);
      expect(raw.addToDataset).toHaveBeenCalledTimes(2);
      // Three attempts for one trace: the first write plus the two retries.
      expect(triggers.claimSend).toHaveBeenCalledTimes(3);
    });

    it("claims on an inline retry so only the failed trace runs again", async () => {
      const { deps, triggers, raw } = makeDeps(datasetTrigger());
      let claimAttempts = 0;
      triggers.claimSend.mockImplementation(async () => {
        claimAttempts += 1;
        if (claimAttempts === 1) throw new Error("claim write failed");
      });
      raw.addToDataset.mockImplementation(
        async ({ datasetRecords }: { datasetRecords: { id: string }[] }) => {
          if (datasetRecords[0]!.id.includes("trace-2")) {
            throw new DispatchError({
              message: "database unavailable",
              retryable: true,
            });
          }
        },
      );

      const payload = {
        triggerId: "trigger-1",
        traceIds: ["trace-1", "trace-2"],
      };
      const thrown = await createPersistMatchHandler(deps)(
        payload,
        context("process:trigger-1:persist:page-1"),
      ).catch((error: unknown) => error);

      // The claim landed on the second attempt, so the page still retries for
      // trace-2 and trace-1 carries a claim into that retry.
      expect(isDispatchError(thrown)).toBe(true);
      expect(triggers.claimSend).toHaveBeenCalledTimes(2);
      expect(triggers.claimSend).toHaveBeenLastCalledWith({
        triggerId: "trigger-1",
        traceId: "trace-1",
        projectId: "project-1",
      });

      // The outbox redelivers the page: the claim filter now holds trace-1,
      // so only trace-2 runs its action again.
      triggers.filterSendClaimed.mockResolvedValue(new Set(["trace-1"]));
      raw.addToDataset.mockClear();
      raw.addToDataset.mockResolvedValue(undefined);
      await createPersistMatchHandler(deps)(payload, {
        ...context("process:trigger-1:persist:page-1"),
        attempt: 2,
      });

      expect(raw.addToDataset).toHaveBeenCalledTimes(1);
      expect(triggers.claimSend).toHaveBeenLastCalledWith({
        triggerId: "trigger-1",
        traceId: "trace-2",
        projectId: "project-1",
      });
    });

    it("still retries the page when every dispatched trace claimed", async () => {
      const { deps, triggers, raw } = makeDeps(datasetTrigger());
      raw.addToDataset.mockImplementation(
        async ({ datasetRecords }: { datasetRecords: { id: string }[] }) => {
          if (datasetRecords[0]!.id.includes("trace-1")) {
            throw new DispatchError({
              message: "database unavailable",
              retryable: true,
            });
          }
        },
      );

      const thrown = await createPersistMatchHandler(deps)(
        { triggerId: "trigger-1", traceIds: ["trace-1", "trace-2"] },
        context("process:trigger-1:persist:page-1"),
      ).catch((error: unknown) => error);

      // trace-2 dispatched and claimed, trace-1 never reached its claim, so
      // no trace holds a side effect without a claim and the retry is clean.
      expect(triggers.claimSend).toHaveBeenCalledTimes(1);
      expect(triggers.claimSend).toHaveBeenCalledWith({
        triggerId: "trigger-1",
        traceId: "trace-2",
        projectId: "project-1",
      });
      expect(isDispatchError(thrown)).toBe(true);
      expect((thrown as DispatchError).retryable).toBe(true);
    });

    /** @scenario "A daily-ceiling breach is reported once per page" */
    it("drops every over-ceiling trace and runs breach containment once", async () => {
      const { deps, triggers, raw } = makeDeps(datasetTrigger());
      raw.consumePersistCapSlot.mockResolvedValue({
        allowed: false,
        count: 101,
        cap: 100,
        skipped: 1,
      });

      await expect(
        createPersistMatchHandler(deps)(
          { triggerId: "trigger-1", traceIds: ["trace-1", "trace-2"] },
          context("process:trigger-1:persist:page-1"),
        ),
      ).resolves.toBeUndefined();

      expect(raw.addToDataset).not.toHaveBeenCalled();
      expect(triggers.claimSend).not.toHaveBeenCalled();
      expect(raw.handlePersistCapBreach).toHaveBeenCalledTimes(1);
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
      const intentContext = context("process:trigger-1:digest:1000:stable-batch");

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
