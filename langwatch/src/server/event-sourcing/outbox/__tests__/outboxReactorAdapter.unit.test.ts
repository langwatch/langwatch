import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Event } from "../../domain/types";
import type { ReactorContext } from "../../reactors/reactor.types";
import type {
  OutboxEnqueueRequest,
  OutboxReactorDefinition,
} from "../outboxReactor.types";
import { adaptOutboxReactor } from "../outboxReactorAdapter";
import {
  TRIGGER_NOTIFY_REACTOR_NAME,
  type SettleStagePayload,
} from "../payload";
import type { OutboxRuntime } from "../setup";

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

const PROJECT_ID = "proj-1";
const TRIGGER_ID = "trig-1";
const TRACE_ID = "trace-1";

function settlePayload(
  overrides: Partial<SettleStagePayload> = {},
): SettleStagePayload {
  return {
    stage: "settle",
    projectId: PROJECT_ID,
    triggerId: TRIGGER_ID,
    traceId: TRACE_ID,
    reactorName: TRIGGER_NOTIFY_REACTOR_NAME,
    auditDedupKey: `${PROJECT_ID}/${TRIGGER_ID}:trace:${TRACE_ID}`,
    foldSnapshotAtEnqueue: { computedInput: "in", computedOutput: "out" },
    ...overrides,
  };
}

function makeRequest(
  overrides: Partial<OutboxEnqueueRequest> = {},
): OutboxEnqueueRequest {
  const payload = settlePayload();
  return {
    dedupKey: payload.auditDedupKey,
    groupKey: `${PROJECT_ID}/notify:${TRIGGER_ID}`,
    payload: payload as unknown as OutboxEnqueueRequest["payload"],
    enqueueOptions: { ttlMs: 12345 },
    ...overrides,
  };
}

function makeDefinition(
  decide: OutboxReactorDefinition<Event>["decide"],
): OutboxReactorDefinition<Event> {
  return { name: "alertTriggerNotifyOutbox", decide };
}

function makeContext(): ReactorContext<unknown> {
  return { tenantId: PROJECT_ID, aggregateId: TRACE_ID, foldState: {} };
}

function makeOutboxStub(): OutboxRuntime {
  return {
    dispatcher: { process: vi.fn(), processBatch: vi.fn() } as any,
    auditAdapter: {} as any,
    attachQueue: vi.fn(),
    enqueueSettle: vi.fn().mockResolvedValue(undefined),
  };
}

describe("adaptOutboxReactor", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("when no outbox runtime is wired", () => {
    it("returns a no-op handle so registration on web is safe", async () => {
      const decide = vi.fn();
      const adapted = adaptOutboxReactor(makeDefinition(decide), undefined);

      await adapted.handle({} as Event, makeContext());

      expect(decide).not.toHaveBeenCalled();
    });
  });

  describe("when decide returns an empty array", () => {
    it("does not call enqueueSettle", async () => {
      const outbox = makeOutboxStub();
      const adapted = adaptOutboxReactor(
        makeDefinition(async () => []),
        outbox,
      );

      await adapted.handle({} as Event, makeContext());

      expect(outbox.enqueueSettle).not.toHaveBeenCalled();
    });
  });

  describe("when decide returns settle-stage requests", () => {
    it("forwards each request to enqueueSettle with the threaded ttlMs", async () => {
      const outbox = makeOutboxStub();
      const adapted = adaptOutboxReactor(
        makeDefinition(async () => [makeRequest()]),
        outbox,
      );

      await adapted.handle({} as Event, makeContext());

      expect(outbox.enqueueSettle).toHaveBeenCalledTimes(1);
      expect(outbox.enqueueSettle).toHaveBeenCalledWith(
        expect.objectContaining({ stage: "settle", triggerId: TRIGGER_ID }),
        { ttlMs: 12345 },
      );
    });

    it("falls back to DEFAULT_TRACE_DEBOUNCE_MS when enqueueOptions is absent", async () => {
      const outbox = makeOutboxStub();
      const adapted = adaptOutboxReactor(
        makeDefinition(async () => [
          makeRequest({ enqueueOptions: undefined }),
        ]),
        outbox,
      );

      await adapted.handle({} as Event, makeContext());

      expect(outbox.enqueueSettle).toHaveBeenCalledWith(
        expect.objectContaining({ stage: "settle" }),
        { ttlMs: 30000 },
      );
    });
  });

  describe("when a request carries a non-settle payload", () => {
    it("skips the request without throwing so a sibling request still enqueues", async () => {
      const outbox = makeOutboxStub();
      const bad = makeRequest({
        payload: {
          stage: "cadence",
        } as unknown as OutboxEnqueueRequest["payload"],
      });
      const good = makeRequest();
      const adapted = adaptOutboxReactor(
        makeDefinition(async () => [bad, good]),
        outbox,
      );

      await adapted.handle({} as Event, makeContext());

      // Bad payload was skipped (the spec architecture's cadence
      // request shape doesn't map onto the GroupQueue settle route),
      // but the well-formed sibling still fired.
      expect(outbox.enqueueSettle).toHaveBeenCalledTimes(1);
    });
  });

  describe("when enqueueSettle throws", () => {
    it("swallows the error and proceeds to the next request", async () => {
      const outbox = makeOutboxStub();
      (outbox.enqueueSettle as any)
        .mockRejectedValueOnce(new Error("redis down"))
        .mockResolvedValueOnce(undefined);
      const adapted = adaptOutboxReactor(
        makeDefinition(async () => [makeRequest(), makeRequest()]),
        outbox,
      );

      await adapted.handle({} as Event, makeContext());

      expect(outbox.enqueueSettle).toHaveBeenCalledTimes(2);
    });
  });
});
