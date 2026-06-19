import { TriggerAction } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TriggerSummary } from "~/server/app-layer/triggers/repositories/trigger.repository";
import {
  sendRenderedTriggerEmail,
  sendTriggerEmail,
} from "~/server/mailer/triggerEmail";
import {
  sendRenderedSlackMessage,
  sendSlackWebhook,
} from "~/server/triggers/sendSlackWebhook";
import { DispatchError } from "../dispatchError";
import { createOutboxDispatcher } from "../dispatcher";
import {
  type CadenceStagePayload,
  type SettleStagePayload,
  TRIGGER_NOTIFY_REACTOR_NAME,
} from "../payload";

// Stable singleton so tests can spy the SAME fns the dispatcher captured at
// import time (`const logger = createLogger(...)` runs once per module).
const loggerMock = vi.hoisted(() => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));
vi.mock("~/utils/logger/server", () => ({
  createLogger: () => loggerMock,
}));

vi.mock("~/utils/posthogErrorCapture", () => ({
  captureException: vi.fn(),
  toError: vi.fn((e) => (e instanceof Error ? e : new Error(String(e)))),
}));

vi.mock("~/server/mailer/triggerEmail", () => ({
  sendTriggerEmail: vi.fn().mockResolvedValue(undefined),
  sendRenderedTriggerEmail: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("~/server/triggers/sendSlackWebhook", () => ({
  sendSlackWebhook: vi.fn().mockResolvedValue(undefined),
  sendRenderedSlackMessage: vi.fn().mockResolvedValue(undefined),
}));

const PROJECT_ID = "proj-1";
const TRIGGER_ID = "trig-1";
const TRACE_ID = "trace-1";

function makeTrigger(overrides: Partial<TriggerSummary> = {}): TriggerSummary {
  return {
    id: TRIGGER_ID,
    projectId: PROJECT_ID,
    name: "Test trigger",
    action: TriggerAction.SEND_EMAIL,
    actionParams: { members: ["ops@example.com"] },
    filters: {},
    alertType: null,
    message: "",
    customGraphId: null,
    notificationCadence: "immediate",
    traceDebounceMs: 30000,
    templates: {
      slackTemplateType: null,
      slackTemplate: null,
      emailSubjectTemplate: null,
      emailBodyTemplate: null,
    },
    ...overrides,
  };
}

function makeCadencePayload(
  overrides: Partial<CadenceStagePayload> = {},
): CadenceStagePayload {
  return {
    stage: "cadence",
    projectId: PROJECT_ID,
    triggerId: TRIGGER_ID,
    reactorName: TRIGGER_NOTIFY_REACTOR_NAME,
    auditDedupKey: `${PROJECT_ID}/${TRIGGER_ID}:trace:${TRACE_ID}`,
    match: { traceId: TRACE_ID, input: "in", output: "out" },
    ...overrides,
  };
}

interface TriggerStub {
  getActiveTraceTriggersForProject: ReturnType<typeof vi.fn>;
  claimSend: ReturnType<typeof vi.fn>;
  isSendClaimed: ReturnType<typeof vi.fn>;
  updateLastRunAt: ReturnType<typeof vi.fn>;
  invalidate: ReturnType<typeof vi.fn>;
}

function makeDeps(trigger: TriggerSummary = makeTrigger()) {
  const triggers: TriggerStub = {
    getActiveTraceTriggersForProject: vi.fn().mockResolvedValue([trigger]),
    claimSend: vi.fn().mockResolvedValue(true),
    isSendClaimed: vi.fn().mockResolvedValue(false),
    updateLastRunAt: vi.fn().mockResolvedValue(undefined),
    invalidate: vi.fn(),
  };
  return {
    triggers: triggers as any,
    baseHost: "https://app.example.com",
    projects: {
      getById: vi
        .fn()
        .mockResolvedValue({ id: PROJECT_ID, slug: "p", name: "Proj" }),
    } as any,
    traceSummaryStore: {
      get: vi.fn().mockResolvedValue(null),
      store: vi.fn(),
    },
    evaluationRuns: { findByTraceId: vi.fn().mockResolvedValue([]) } as any,
    deriveEvents: vi.fn().mockResolvedValue([]),
    traceById: vi.fn().mockResolvedValue(undefined),
    // ADR-032: persist-class side-effect sinks. Notify dispatch never
    // touches them; persist cadence (ADD_TO_DATASET /
    // ADD_TO_ANNOTATION_QUEUE) calls them via dispatchTriggerAction.
    addToAnnotationQueue: vi.fn().mockResolvedValue(undefined),
    addToDataset: vi.fn().mockResolvedValue(undefined),
    enqueueCadence: vi.fn().mockResolvedValue(undefined),
    emailHourlyCap: 100,
    consumeEmailCapSlot: vi.fn().mockResolvedValue({ allowed: true, count: 1 }),
    tenantDailyCap: 10000,
    consumeTenantEmailCapSlot: vi
      .fn()
      .mockResolvedValue({ allowed: true, count: 1 }),
    filterSuppressedEmails: vi
      .fn()
      .mockImplementation(async ({ emails }: { emails: string[] }) => emails),
  };
}

describe("createOutboxDispatcher cadence stage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("when the first cadence attempt's provider call fails retryably", () => {
    it("re-sends on the second attempt rather than no-opping via a stale claim", async () => {
      const deps = makeDeps();
      const dispatcher = createOutboxDispatcher(deps);

      vi.mocked(sendTriggerEmail).mockRejectedValueOnce(
        new DispatchError({ message: "transient SES outage", retryable: true }),
      );
      vi.mocked(sendTriggerEmail).mockResolvedValueOnce(undefined);

      const payload = makeCadencePayload();

      await expect(dispatcher.process(payload)).rejects.toBeInstanceOf(
        DispatchError,
      );

      // First attempt: the cross-batch read-only check ran, but the
      // at-most-once claim must NOT have been committed — otherwise the
      // retry below would silently no-op.
      expect(deps.triggers.isSendClaimed).toHaveBeenCalledTimes(1);
      expect(deps.triggers.claimSend).not.toHaveBeenCalled();
      expect(sendTriggerEmail).toHaveBeenCalledTimes(1);

      await dispatcher.process(payload);

      // Second attempt actually sent — the regression Sergio flagged is
      // that this `expect(2)` would be `1` if `claimSend` had landed
      // pre-dispatch on the first attempt.
      expect(sendTriggerEmail).toHaveBeenCalledTimes(2);
      // And the claim now lands AFTER the successful send.
      expect(deps.triggers.claimSend).toHaveBeenCalledTimes(1);
      expect(deps.triggers.claimSend).toHaveBeenCalledWith({
        triggerId: TRIGGER_ID,
        traceId: TRACE_ID,
        projectId: PROJECT_ID,
      });

      // The cap is consumed with the SAME stable per-dispatch dedupKey on both
      // the failed first attempt and the retry — so the cap module's claim gate
      // recognises the retry and does not burn a second slot (FIX: retry
      // double-count). The dedupKey is the digest over the batch's traceIds.
      const capCalls = deps.consumeEmailCapSlot.mock.calls;
      expect(capCalls).toHaveLength(2);
      expect(capCalls[0]![0].dedupKey).toMatch(
        new RegExp(`^${PROJECT_ID}/${TRIGGER_ID}:digest:[0-9a-f]{16}$`),
      );
      expect(capCalls[1]![0].dedupKey).toBe(capCalls[0]![0].dedupKey);
    });
  });

  describe("when a (trigger, trace) pair has already been claimed", () => {
    it("skips the dispatch via the read-only isSendClaimed check", async () => {
      const deps = makeDeps();
      deps.triggers.isSendClaimed.mockResolvedValueOnce(true);
      const dispatcher = createOutboxDispatcher(deps);

      await dispatcher.process(makeCadencePayload());

      expect(deps.triggers.isSendClaimed).toHaveBeenCalledTimes(1);
      expect(sendTriggerEmail).not.toHaveBeenCalled();
      expect(deps.triggers.claimSend).not.toHaveBeenCalled();
    });
  });

  describe("when a successful dispatch is followed by a claimSend write failure", () => {
    it("swallows the claim failure so the outbox does not retry and double-send", async () => {
      const deps = makeDeps();
      deps.triggers.claimSend.mockRejectedValueOnce(new Error("PG down"));
      const dispatcher = createOutboxDispatcher(deps);

      await expect(
        dispatcher.process(makeCadencePayload()),
      ).resolves.toBeUndefined();

      expect(sendTriggerEmail).toHaveBeenCalledTimes(1);
      expect(deps.triggers.claimSend).toHaveBeenCalledTimes(1);
    });
  });

  describe("when the mailer consults the per-recipient idempotency gate", () => {
    it("backs both callbacks with the TriggerSent claim store under a rcpt:-prefixed key stable across retries", async () => {
      const deps = makeDeps();
      const dispatcher = createOutboxDispatcher(deps);

      await dispatcher.process(makeCadencePayload());

      const args = vi.mocked(sendTriggerEmail).mock.calls[0]?.[0];
      expect(args?.isRecipientSent).toBeTypeOf("function");
      expect(args?.recordRecipientSent).toBeTypeOf("function");

      deps.triggers.isSendClaimed.mockClear();
      deps.triggers.claimSend.mockClear();

      await args!.isRecipientSent!("a1b2c3");
      await args!.recordRecipientSent!("a1b2c3");

      const readKey = deps.triggers.isSendClaimed.mock.calls[0]?.[0];
      const writeKey = deps.triggers.claimSend.mock.calls[0]?.[0];
      expect(readKey).toEqual({
        triggerId: TRIGGER_ID,
        projectId: PROJECT_ID,
        traceId: expect.stringMatching(/^rcpt:[0-9a-f]{16}:a1b2c3$/),
      });
      // Read and write must target the SAME key, or retries would never
      // observe the recorded delivery.
      expect(writeKey).toEqual(readKey);
    });
  });

  describe("when the same traceId appears twice in a coalesced batch", () => {
    it("dedupes in-batch before the dispatch so the digest carries one row per trace", async () => {
      const deps = makeDeps();
      const dispatcher = createOutboxDispatcher(deps);

      await dispatcher.processBatch([
        makeCadencePayload(),
        makeCadencePayload(),
      ]);

      // isSendClaimed reads once per unique trace, not per payload.
      expect(deps.triggers.isSendClaimed).toHaveBeenCalledTimes(1);
      expect(sendTriggerEmail).toHaveBeenCalledTimes(1);
      expect(deps.triggers.claimSend).toHaveBeenCalledTimes(1);
    });
  });

  describe("when the trigger has a custom email template", () => {
    it("renders the Liquid template and dispatches via the rendered send path", async () => {
      const trigger = makeTrigger({
        action: TriggerAction.SEND_EMAIL,
        name: "Latency alert",
        templates: {
          slackTemplateType: null,
          slackTemplate: null,
          emailSubjectTemplate: null,
          emailBodyTemplate:
            "Hello {{ trigger.name }} — {{ matches.size }} match",
        },
      });
      const deps = makeDeps(trigger);
      const dispatcher = createOutboxDispatcher(deps);

      await dispatcher.process(makeCadencePayload());

      expect(sendTriggerEmail).not.toHaveBeenCalled();
      expect(sendRenderedTriggerEmail).toHaveBeenCalledTimes(1);
      const arg = vi.mocked(sendRenderedTriggerEmail).mock.calls[0]![0];
      expect(arg.triggerId).toBe(TRIGGER_ID);
      expect(arg.html).toContain("Latency alert");
      expect(arg.html).toContain("1 match");
      expect(deps.triggers.claimSend).toHaveBeenCalledTimes(1);
    });
  });

  describe("when the trigger has a custom Slack template", () => {
    it("renders the Liquid template and dispatches via the rendered slack path", async () => {
      const trigger = makeTrigger({
        action: TriggerAction.SEND_SLACK_MESSAGE,
        name: "Latency alert",
        actionParams: { slackWebhook: "https://hooks.slack.com/services/x" },
        templates: {
          slackTemplateType: "string",
          slackTemplate: "Hello {{ trigger.name }} — {{ matches.size }} match",
          emailSubjectTemplate: null,
          emailBodyTemplate: null,
        },
      });
      const deps = makeDeps(trigger);
      const dispatcher = createOutboxDispatcher(deps);

      await dispatcher.process(makeCadencePayload());

      expect(sendSlackWebhook).not.toHaveBeenCalled();
      expect(sendRenderedSlackMessage).toHaveBeenCalledTimes(1);
      const arg = vi.mocked(sendRenderedSlackMessage).mock.calls[0]![0];
      expect(arg.triggerWebhook).toBe("https://hooks.slack.com/services/x");
      expect(JSON.stringify(arg.payload)).toContain("Latency alert");
      expect(JSON.stringify(arg.payload)).toContain("1 match");
      expect(deps.triggers.claimSend).toHaveBeenCalledTimes(1);
    });
  });

  describe("given template render-diagnostics (ADR-028 / ADR-029)", () => {
    describe("when a custom email template references variables the context does not supply", () => {
      it("stamps the missing variables onto the payload's renderDiagnostics", async () => {
        const trigger = makeTrigger({
          action: TriggerAction.SEND_EMAIL,
          name: "Latency alert",
          templates: {
            slackTemplateType: null,
            slackTemplate: null,
            emailSubjectTemplate: null,
            emailBodyTemplate: "Hi {{ trigger.name }} — {{ does.not.exist }}",
          },
        });
        const deps = makeDeps(trigger);
        const dispatcher = createOutboxDispatcher(deps);
        const payload = makeCadencePayload();

        await dispatcher.process(payload);

        // The render still succeeds (strictVariables: false renders the typo as
        // empty), so the email is delivered — but the diagnostic is captured so
        // the PG audit adapter can persist it to ReactorOutbox.renderDiagnostics.
        expect(sendRenderedTriggerEmail).toHaveBeenCalledTimes(1);
        expect(payload.renderDiagnostics).toEqual({
          missingVariables: ["does.not.exist"],
        });
      });
    });

    describe("when a custom email template renders cleanly", () => {
      it("sets renderDiagnostics to null so a clean render is distinguishable from one never computed", async () => {
        const trigger = makeTrigger({
          action: TriggerAction.SEND_EMAIL,
          name: "Latency alert",
          templates: {
            slackTemplateType: null,
            slackTemplate: null,
            emailSubjectTemplate: null,
            emailBodyTemplate: "Hello {{ trigger.name }}",
          },
        });
        const deps = makeDeps(trigger);
        const dispatcher = createOutboxDispatcher(deps);
        const payload = makeCadencePayload();

        await dispatcher.process(payload);

        expect(sendRenderedTriggerEmail).toHaveBeenCalledTimes(1);
        expect(payload.renderDiagnostics).toBeNull();
      });
    });

    describe("when a custom Slack template references variables the context does not supply", () => {
      it("stamps the missing variables onto the payload's renderDiagnostics", async () => {
        const trigger = makeTrigger({
          action: TriggerAction.SEND_SLACK_MESSAGE,
          name: "Latency alert",
          actionParams: { slackWebhook: "https://hooks.slack.com/services/x" },
          templates: {
            slackTemplateType: "string",
            slackTemplate: "Hi {{ trigger.name }} — {{ does.not.exist }}",
            emailSubjectTemplate: null,
            emailBodyTemplate: null,
          },
        });
        const deps = makeDeps(trigger);
        const dispatcher = createOutboxDispatcher(deps);
        const payload = makeCadencePayload();

        await dispatcher.process(payload);

        expect(sendRenderedSlackMessage).toHaveBeenCalledTimes(1);
        expect(payload.renderDiagnostics).toEqual({
          missingVariables: ["does.not.exist"],
        });
      });
    });

    describe("when the trigger has no custom template (legacy senders)", () => {
      it("sets renderDiagnostics to null because nothing rendered", async () => {
        const deps = makeDeps();
        const dispatcher = createOutboxDispatcher(deps);
        const payload = makeCadencePayload();

        await dispatcher.process(payload);

        expect(sendTriggerEmail).toHaveBeenCalledTimes(1);
        expect(payload.renderDiagnostics).toBeNull();
      });
    });
  });

  describe("given the per-trigger hourly email cap (ADR-031)", () => {
    describe("when the dispatch is under the cap", () => {
      it("sends the email normally and records the claim", async () => {
        const deps = makeDeps();
        deps.consumeEmailCapSlot.mockResolvedValueOnce({
          allowed: true,
          count: 7,
        });
        const dispatcher = createOutboxDispatcher(deps);

        await dispatcher.process(makeCadencePayload());

        expect(deps.consumeEmailCapSlot).toHaveBeenCalledTimes(1);
        expect(sendTriggerEmail).toHaveBeenCalledTimes(1);
        expect(deps.triggers.claimSend).toHaveBeenCalledTimes(1);
      });
    });

    describe("when the dispatch is over the cap", () => {
      it("drops without sending, without throwing, but still records the claim so replays no-op", async () => {
        const deps = makeDeps();
        deps.consumeEmailCapSlot.mockResolvedValueOnce({
          allowed: false,
          count: 101,
        });
        const dispatcher = createOutboxDispatcher(deps);

        await expect(
          dispatcher.process(makeCadencePayload()),
        ).resolves.toBeUndefined();

        expect(sendTriggerEmail).not.toHaveBeenCalled();
        expect(sendRenderedTriggerEmail).not.toHaveBeenCalled();
        // Claim is recorded so an outbox replay is a no-op, not a re-send.
        expect(deps.triggers.claimSend).toHaveBeenCalledTimes(1);
        // ...but the drop must NOT run delivery-only bookkeeping: the
        // "last-fired" cosmetic would misrepresent a dropped no-op as a send.
        expect(deps.triggers.updateLastRunAt).not.toHaveBeenCalled();
      });

      it("stamps an over-cap drop reason on the payload and logs the drop so the audit row is not delivered-looking", async () => {
        const deps = makeDeps();
        deps.consumeEmailCapSlot.mockResolvedValueOnce({
          allowed: false,
          count: 101,
        });
        const dispatcher = createOutboxDispatcher(deps);
        const payload = makeCadencePayload();

        await dispatcher.process(payload);

        // The PG audit adapter reads `dropReason` off the payload in
        // onDispatched and records it as lastError instead of null.
        expect(payload.dropReason).toBe("dropped: over hourly cap");
        // The over-cap branch logs loudly at error; the terminal drop logs at
        // info with the reason. Both fire — the drop is visible, not silent.
        expect(loggerMock.error).toHaveBeenCalled();
        expect(loggerMock.info).toHaveBeenCalledWith(
          expect.objectContaining({ dropReason: "dropped: over hourly cap" }),
          expect.stringContaining("dropped"),
        );
      });
    });

    describe("when the trigger sends Slack rather than email", () => {
      it("never consults the email cap", async () => {
        const trigger = makeTrigger({
          action: TriggerAction.SEND_SLACK_MESSAGE,
          actionParams: { slackWebhook: "https://hooks.slack.com/services/x" },
        });
        const deps = makeDeps(trigger);
        const dispatcher = createOutboxDispatcher(deps);

        await dispatcher.process(makeCadencePayload());

        expect(deps.consumeEmailCapSlot).not.toHaveBeenCalled();
        expect(sendSlackWebhook).toHaveBeenCalledTimes(1);
      });
    });

    describe("when a fresh hour opens after the cap was exhausted", () => {
      it("allows the email again because the slot consumer reports allowed", async () => {
        const deps = makeDeps();
        deps.consumeEmailCapSlot
          .mockResolvedValueOnce({ allowed: false, count: 101 })
          .mockResolvedValueOnce({ allowed: true, count: 1 });
        const dispatcher = createOutboxDispatcher(deps);

        await dispatcher.process(makeCadencePayload());
        expect(sendTriggerEmail).not.toHaveBeenCalled();

        await dispatcher.process(
          makeCadencePayload({
            match: { traceId: "trace-2", input: "in", output: "out" },
            auditDedupKey: `${PROJECT_ID}/${TRIGGER_ID}:trace:trace-2`,
          }),
        );
        expect(sendTriggerEmail).toHaveBeenCalledTimes(1);
      });
    });
  });

  describe("given the per-project daily email cap (ADR-031)", () => {
    describe("when the dispatch is under the daily cap", () => {
      it("consults the tenant cap by recipient count and sends normally", async () => {
        const trigger = makeTrigger({
          action: TriggerAction.SEND_EMAIL,
          actionParams: {
            members: ["a@example.com", "b@example.com", "c@example.com"],
          },
        });
        const deps = makeDeps(trigger);
        const dispatcher = createOutboxDispatcher(deps);

        await dispatcher.process(makeCadencePayload());

        expect(deps.consumeTenantEmailCapSlot).toHaveBeenCalledTimes(1);
        // The daily cap counts RECIPIENTS, so recipientCount is the surviving
        // recipient-list length, not 1-per-dispatch.
        expect(deps.consumeTenantEmailCapSlot).toHaveBeenCalledWith(
          expect.objectContaining({
            projectId: PROJECT_ID,
            recipientCount: 3,
            cap: 10000,
            dedupKey: expect.stringMatching(
              new RegExp(`^${PROJECT_ID}:tenant:[0-9a-f]{16}$`),
            ),
          }),
        );
        expect(sendTriggerEmail).toHaveBeenCalledTimes(1);
      });
    });

    describe("when the dispatch exceeds the project's daily cap", () => {
      it("drops without sending, stamps the project-daily drop reason, and logs at warn", async () => {
        const deps = makeDeps();
        deps.consumeTenantEmailCapSlot.mockResolvedValueOnce({
          allowed: false,
          count: 10001,
        });
        const dispatcher = createOutboxDispatcher(deps);
        const payload = makeCadencePayload();

        await expect(dispatcher.process(payload)).resolves.toBeUndefined();

        // No send — the daily cap is a terminal, non-retryable drop.
        expect(sendTriggerEmail).not.toHaveBeenCalled();
        expect(sendRenderedTriggerEmail).not.toHaveBeenCalled();
        // The hourly cap ran and passed; the tenant cap is what dropped it.
        expect(deps.consumeEmailCapSlot).toHaveBeenCalledTimes(1);
        // Claim recorded so a replay no-ops; delivery-only bookkeeping skipped.
        expect(deps.triggers.claimSend).toHaveBeenCalledTimes(1);
        expect(deps.triggers.updateLastRunAt).not.toHaveBeenCalled();
        // Audit row reads as a drop, not a delivered send.
        expect(payload.dropReason).toBe(
          "dropped: over project daily email cap",
        );
        // The project-daily backstop logs the over-cap event at WARN.
        expect(loggerMock.warn).toHaveBeenCalledWith(
          expect.objectContaining({ cap: 10000, count: 10001 }),
          expect.stringContaining("daily"),
        );
        // And the terminal drop log carries the reason.
        expect(loggerMock.info).toHaveBeenCalledWith(
          expect.objectContaining({
            dropReason: "dropped: over project daily email cap",
          }),
          expect.stringContaining("dropped"),
        );
      });
    });

    describe("when the hourly cap has already dropped the dispatch", () => {
      it("never consults the project daily cap", async () => {
        const deps = makeDeps();
        deps.consumeEmailCapSlot.mockResolvedValueOnce({
          allowed: false,
          count: 101,
        });
        const dispatcher = createOutboxDispatcher(deps);

        await dispatcher.process(makeCadencePayload());

        // Hourly cap is checked first; its drop short-circuits before the
        // tenant cap so we don't count recipients against a dispatch we already
        // dropped.
        expect(deps.consumeTenantEmailCapSlot).not.toHaveBeenCalled();
        expect(sendTriggerEmail).not.toHaveBeenCalled();
      });
    });

    describe("when the trigger sends Slack rather than email", () => {
      it("never consults the project daily cap", async () => {
        const trigger = makeTrigger({
          action: TriggerAction.SEND_SLACK_MESSAGE,
          actionParams: { slackWebhook: "https://hooks.slack.com/services/x" },
        });
        const deps = makeDeps(trigger);
        const dispatcher = createOutboxDispatcher(deps);

        await dispatcher.process(makeCadencePayload());

        expect(deps.consumeTenantEmailCapSlot).not.toHaveBeenCalled();
        expect(sendSlackWebhook).toHaveBeenCalledTimes(1);
      });
    });
  });

  describe("given recipient suppression (ADR-031)", () => {
    describe("when some but not all recipients are suppressed", () => {
      it("sends only to the recipients the filter returns", async () => {
        const trigger = makeTrigger({
          action: TriggerAction.SEND_EMAIL,
          actionParams: {
            members: ["keep@example.com", "gone@example.com"],
          },
        });
        const deps = makeDeps(trigger);
        deps.filterSuppressedEmails.mockResolvedValueOnce(["keep@example.com"]);
        const dispatcher = createOutboxDispatcher(deps);

        await dispatcher.process(makeCadencePayload());

        expect(sendTriggerEmail).toHaveBeenCalledTimes(1);
        expect(sendTriggerEmail).toHaveBeenCalledWith(
          expect.objectContaining({ triggerEmails: ["keep@example.com"] }),
        );
      });
    });

    describe("when every recipient is suppressed", () => {
      it("skips the send entirely and records the claim without throwing or burning a cap slot", async () => {
        const deps = makeDeps();
        deps.filterSuppressedEmails.mockResolvedValueOnce([]);
        const dispatcher = createOutboxDispatcher(deps);

        await expect(
          dispatcher.process(makeCadencePayload()),
        ).resolves.toBeUndefined();

        expect(sendTriggerEmail).not.toHaveBeenCalled();
        expect(sendRenderedTriggerEmail).not.toHaveBeenCalled();
        // Suppression runs before the cap — an all-suppressed dispatch must
        // not consume a slot.
        expect(deps.consumeEmailCapSlot).not.toHaveBeenCalled();
        expect(deps.triggers.claimSend).toHaveBeenCalledTimes(1);
        // Drop must not run the delivery-only "last-fired" bookkeeping.
        expect(deps.triggers.updateLastRunAt).not.toHaveBeenCalled();
      });

      it("stamps an all-suppressed drop reason on the payload and logs the drop", async () => {
        const deps = makeDeps();
        deps.filterSuppressedEmails.mockResolvedValueOnce([]);
        const dispatcher = createOutboxDispatcher(deps);
        const payload = makeCadencePayload();

        await dispatcher.process(payload);

        // Recorded as lastError by the audit adapter, so a fully-suppressed
        // dispatch is distinguishable from a delivered send in the audit row.
        expect(payload.dropReason).toBe("dropped: all recipients suppressed");
        expect(loggerMock.info).toHaveBeenCalledWith(
          expect.objectContaining({
            dropReason: "dropped: all recipients suppressed",
          }),
          expect.stringContaining("dropped"),
        );
      });
    });

    describe("when a custom-template trigger has some recipients suppressed", () => {
      it("renders and sends to only the filtered recipients", async () => {
        const trigger = makeTrigger({
          action: TriggerAction.SEND_EMAIL,
          name: "Latency alert",
          actionParams: {
            members: ["keep@example.com", "gone@example.com"],
          },
          templates: {
            slackTemplateType: null,
            slackTemplate: null,
            emailSubjectTemplate: null,
            emailBodyTemplate: "Hi {{ trigger.name }}",
          },
        });
        const deps = makeDeps(trigger);
        deps.filterSuppressedEmails.mockResolvedValueOnce(["keep@example.com"]);
        const dispatcher = createOutboxDispatcher(deps);

        await dispatcher.process(makeCadencePayload());

        expect(sendTriggerEmail).not.toHaveBeenCalled();
        expect(sendRenderedTriggerEmail).toHaveBeenCalledTimes(1);
        expect(sendRenderedTriggerEmail).toHaveBeenCalledWith(
          expect.objectContaining({ triggerEmails: ["keep@example.com"] }),
        );
      });
    });
  });
});

// ADR-032: persist-class actions ride the same settle → cadence outbox
// path as notify. These exercise the persist branches of handleSettle
// and handleCadenceBatch and confirm they never touch the notify senders.
function makePersistTrigger(
  overrides: Partial<TriggerSummary> = {},
): TriggerSummary {
  return makeTrigger({
    action: TriggerAction.ADD_TO_ANNOTATION_QUEUE,
    actionParams: {
      annotators: [{ id: "annotator-1", name: "Ops" }],
      createdByUserId: "user-1",
    },
    ...overrides,
  });
}

function makePersistFold(origin = "application") {
  // A complete-enough fold: the settle stage builds precondition trace
  // data from it (reads models / annotationIds / etc.), so a minimal stub
  // would NPE in buildPreconditionTraceDataFromFoldState. The trace-origin
  // filter reads langwatch.origin; dispatchTriggerAction reads only
  // computedInput/Output.
  return {
    traceId: TRACE_ID,
    spanCount: 1,
    totalDurationMs: 100,
    computedIOSchemaVersion: "1",
    computedInput: "in",
    computedOutput: "out",
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
    attributes: { "langwatch.origin": origin },
  } as any;
}

function makePersistSettlePayload(
  overrides: Partial<SettleStagePayload> = {},
): SettleStagePayload {
  return {
    stage: "settle",
    projectId: PROJECT_ID,
    triggerId: TRIGGER_ID,
    reactorName: TRIGGER_NOTIFY_REACTOR_NAME,
    actionClass: "persist",
    auditDedupKey: `${PROJECT_ID}/${TRIGGER_ID}:trace:${TRACE_ID}`,
    traceId: TRACE_ID,
    foldSnapshotAtEnqueue: { computedInput: "in", computedOutput: "out" },
    ...overrides,
  };
}

function makePersistCadencePayload(
  overrides: Partial<CadenceStagePayload> = {},
): CadenceStagePayload {
  return makeCadencePayload({ actionClass: "persist", ...overrides });
}

describe("createOutboxDispatcher persist class (ADR-032)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("given a persist settle payload", () => {
    describe("when the settled fold matches the trace filters", () => {
      it("re-enqueues an immediate cadence stamped actionClass=persist and dispatches nothing yet", async () => {
        const deps = makeDeps(makePersistTrigger());
        deps.traceSummaryStore.get.mockResolvedValue(makePersistFold());
        const dispatcher = createOutboxDispatcher(deps);

        await dispatcher.process(makePersistSettlePayload());

        // Settle re-enqueues cadence; it claims/dispatches nothing itself.
        expect(deps.enqueueCadence).toHaveBeenCalledTimes(1);
        const [cadencePayload, options] = deps.enqueueCadence.mock.calls[0]!;
        expect(cadencePayload.stage).toBe("cadence");
        expect(cadencePayload.actionClass).toBe("persist");
        expect(cadencePayload.match.traceId).toBe(TRACE_ID);
        // Persist is immediate — no digest delay.
        expect(options.delayMs).toBe(0);
        // No side effect, no claim at the settle stage.
        expect(deps.addToAnnotationQueue).not.toHaveBeenCalled();
        expect(deps.triggers.claimSend).not.toHaveBeenCalled();
      });
    });

    describe("when the settled fold does not match the trace filters", () => {
      it("dispatches nothing and enqueues no cadence", async () => {
        const deps = makeDeps(
          makePersistTrigger({ filters: { "traces.origin": ["playground"] } }),
        );
        // Fold origin is "application", filter wants "playground".
        deps.traceSummaryStore.get.mockResolvedValue(
          makePersistFold("application"),
        );
        const dispatcher = createOutboxDispatcher(deps);

        await dispatcher.process(makePersistSettlePayload());

        expect(deps.enqueueCadence).not.toHaveBeenCalled();
        expect(deps.addToAnnotationQueue).not.toHaveBeenCalled();
        expect(deps.triggers.claimSend).not.toHaveBeenCalled();
      });
    });

    describe("when the trace fold is gone", () => {
      it("dispatches nothing and enqueues no cadence", async () => {
        const deps = makeDeps(makePersistTrigger());
        deps.traceSummaryStore.get.mockResolvedValue(null);
        const dispatcher = createOutboxDispatcher(deps);

        await dispatcher.process(makePersistSettlePayload());

        expect(deps.enqueueCadence).not.toHaveBeenCalled();
        expect(deps.addToAnnotationQueue).not.toHaveBeenCalled();
      });
    });
  });

  describe("given a persist cadence payload", () => {
    describe("when the pair has not been claimed", () => {
      it("re-reads the settled fold, dispatches via dispatchTriggerAction, then claims post-success", async () => {
        const deps = makeDeps(makePersistTrigger());
        deps.traceSummaryStore.get.mockResolvedValue(makePersistFold());
        const dispatcher = createOutboxDispatcher(deps);

        await dispatcher.process(makePersistCadencePayload());

        // Cross-batch dedup read ran first.
        expect(deps.triggers.isSendClaimed).toHaveBeenCalledTimes(1);
        // The persist side effect fired (ADD_TO_ANNOTATION_QUEUE).
        expect(deps.addToAnnotationQueue).toHaveBeenCalledTimes(1);
        expect(deps.addToAnnotationQueue).toHaveBeenCalledWith(
          expect.objectContaining({
            traceIds: [TRACE_ID],
            projectId: PROJECT_ID,
          }),
        );
        // Claim is written AFTER the successful dispatch (retry-safe).
        expect(deps.triggers.claimSend).toHaveBeenCalledTimes(1);
        expect(deps.triggers.claimSend).toHaveBeenCalledWith({
          triggerId: TRIGGER_ID,
          traceId: TRACE_ID,
          projectId: PROJECT_ID,
        });
        // It must NOT touch the notify senders.
        expect(sendTriggerEmail).not.toHaveBeenCalled();
        expect(sendSlackWebhook).not.toHaveBeenCalled();
      });
    });

    describe("when the pair was already claimed by an earlier run", () => {
      it("skips the dispatch via the read-only isSendClaimed check", async () => {
        const deps = makeDeps(makePersistTrigger());
        deps.traceSummaryStore.get.mockResolvedValue(makePersistFold());
        deps.triggers.isSendClaimed.mockResolvedValueOnce(true);
        const dispatcher = createOutboxDispatcher(deps);

        await dispatcher.process(makePersistCadencePayload());

        expect(deps.triggers.isSendClaimed).toHaveBeenCalledTimes(1);
        expect(deps.addToAnnotationQueue).not.toHaveBeenCalled();
        expect(deps.triggers.claimSend).not.toHaveBeenCalled();
      });
    });

    describe("when the same traceId appears twice in the batch", () => {
      it("dedupes in-batch so the side effect fires once", async () => {
        const deps = makeDeps(makePersistTrigger());
        deps.traceSummaryStore.get.mockResolvedValue(makePersistFold());
        const dispatcher = createOutboxDispatcher(deps);

        await dispatcher.processBatch([
          makePersistCadencePayload(),
          makePersistCadencePayload(),
        ]);

        expect(deps.triggers.isSendClaimed).toHaveBeenCalledTimes(1);
        expect(deps.addToAnnotationQueue).toHaveBeenCalledTimes(1);
        expect(deps.triggers.claimSend).toHaveBeenCalledTimes(1);
      });
    });

    describe("when dispatchTriggerAction fails retryably", () => {
      it("does not claim, so the outbox retry re-dispatches rather than no-opping", async () => {
        const deps = makeDeps(makePersistTrigger());
        deps.traceSummaryStore.get.mockResolvedValue(makePersistFold());
        deps.addToAnnotationQueue
          .mockRejectedValueOnce(
            new DispatchError({ message: "queue 503", retryable: true }),
          )
          .mockResolvedValueOnce(undefined);
        const dispatcher = createOutboxDispatcher(deps);

        // First attempt throws (so the outbox marks it for retry)...
        await expect(
          dispatcher.process(makePersistCadencePayload()),
        ).rejects.toBeInstanceOf(DispatchError);
        // ...and crucially the claim did NOT land, or the retry would no-op.
        expect(deps.triggers.claimSend).not.toHaveBeenCalled();

        // Retry succeeds and now claims.
        await dispatcher.process(makePersistCadencePayload());
        expect(deps.addToAnnotationQueue).toHaveBeenCalledTimes(2);
        expect(deps.triggers.claimSend).toHaveBeenCalledTimes(1);
      });
    });
  });

  describe("at-most-once across a settle then cadence run for the same pair", () => {
    it("claims exactly once: the settle re-enqueues, the cadence dispatches+claims, a replayed cadence no-ops", async () => {
      const deps = makeDeps(makePersistTrigger());
      deps.traceSummaryStore.get.mockResolvedValue(makePersistFold());
      const dispatcher = createOutboxDispatcher(deps);

      // 1) Settle matches → enqueues cadence, no claim yet.
      await dispatcher.process(makePersistSettlePayload());
      expect(deps.enqueueCadence).toHaveBeenCalledTimes(1);
      expect(deps.triggers.claimSend).not.toHaveBeenCalled();
      const enqueuedCadence = deps.enqueueCadence.mock
        .calls[0]![0] as CadenceStagePayload;

      // 2) Cadence runs → dispatch + claim once.
      await dispatcher.process(enqueuedCadence);
      expect(deps.addToAnnotationQueue).toHaveBeenCalledTimes(1);
      expect(deps.triggers.claimSend).toHaveBeenCalledTimes(1);

      // 3) A replayed cadence for the SAME pair sees the claim and no-ops.
      deps.triggers.isSendClaimed.mockResolvedValueOnce(true);
      await dispatcher.process(enqueuedCadence);
      expect(deps.addToAnnotationQueue).toHaveBeenCalledTimes(1);
      expect(deps.triggers.claimSend).toHaveBeenCalledTimes(1);
    });
  });
});
