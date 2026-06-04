import { TriggerAction } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TriggerSummary } from "~/server/app-layer/triggers/repositories/trigger.repository";
import { sendTriggerEmail } from "~/server/mailer/triggerEmail";
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
}));

vi.mock("~/server/triggers/sendSlackWebhook", () => ({
  sendSlackWebhook: vi.fn().mockResolvedValue(undefined),
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
    projects: {
      getById: vi.fn().mockResolvedValue({ id: PROJECT_ID, slug: "p" }),
    } as any,
    traceSummaryStore: {
      get: vi.fn().mockResolvedValue(null),
      store: vi.fn(),
    },
    evaluationRuns: { findByTraceId: vi.fn().mockResolvedValue([]) } as any,
    deriveEvents: vi.fn().mockResolvedValue([]),
    traceById: vi.fn().mockResolvedValue(undefined),
    enqueueCadence: vi.fn().mockResolvedValue(undefined),
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
});
