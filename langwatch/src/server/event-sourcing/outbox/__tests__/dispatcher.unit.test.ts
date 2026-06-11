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
  TRIGGER_NOTIFY_REACTOR_NAME,
} from "../payload";

vi.mock("~/utils/logger/server", () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

vi.mock("~/utils/posthogErrorCapture", () => ({
  captureException: vi.fn(),
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
    enqueueCadence: vi.fn().mockResolvedValue(undefined),
    emailHourlyCap: 100,
    consumeEmailCapSlot: vi
      .fn()
      .mockResolvedValue({ allowed: true, count: 1 }),
    filterSuppressedEmails: vi
      .fn()
      .mockImplementation(
        async ({ emails }: { emails: string[] }) => emails,
      ),
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
          emailBodyTemplate: "Hello {{ trigger.name }} — {{ matches.size }} match",
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
