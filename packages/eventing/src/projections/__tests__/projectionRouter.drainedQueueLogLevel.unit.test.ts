/**
 * @vitest-environment node
 * A dispatch refused because the queue's drain already finished is a shutdown race,
 * kept for re-drive, so it warns; every other dispatch failure is still an error.
 * @see specs/background/queue-drain-send-gate.feature
 */
import { GroupQueueError, QueueStagingClosedError } from "@langwatch/group-queue";
import type * as observabilityModule from "@langwatch/observability";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Event } from "../../domain/types.ts";
import {
  createTestAggregateType,
  createTestEvent,
  createTestEventStoreReadContext,
  createTestTenantId,
  TEST_CONSTANTS,
} from "../../services/__tests__/testHelpers.ts";
import type { QueueManager } from "../../services/queues/queueManager.ts";
import { ProjectionRouter } from "../projectionRouter.ts";

const { warnSpy, errorSpy } = vi.hoisted(() => ({ warnSpy: vi.fn(), errorSpy: vi.fn() }));

vi.mock("@langwatch/observability", async (importOriginal) => {
  const actual = await importOriginal<typeof observabilityModule>();
  return {
    ...actual,
    createLogger: () => ({
      warn: warnSpy,
      error: errorSpy,
      info: vi.fn(),
      debug: vi.fn(),
      trace: vi.fn(),
      fatal: vi.fn(),
    }),
  };
});

const aggregateType = createTestAggregateType();
const tenantId = createTestTenantId();
const readContext = createTestEventStoreReadContext(tenantId);
const DISPATCH_FAILED = "Event subscriber dispatch failed";

/** Only the subscriber lane is queued, and its queue refuses with `refusal`. */
function routerWhoseQueueRefuses(refusal: Error): ProjectionRouter<Event> {
  const queue = { send: () => Promise.reject(refusal) };
  // Every other lane answers "not queued", so only the subscriber's send is exercised.
  const queueManager = new Proxy(
    {},
    {
      get: (_target, method) => () => {
        if (method === "hasSubscriberQueues") return true;
        if (method === "getSubscriberQueue") return queue;
        return String(method).startsWith("has") ? false : undefined;
      },
    },
  ) as QueueManager<Event>;
  const router = new ProjectionRouter<Event>({
    aggregateType,
    pipelineName: TEST_CONSTANTS.PIPELINE_NAME,
    queueManager,
  });
  router.registerEventSubscriber({ name: "drainedSubscriber", eventTypes: [], handle: vi.fn() });
  return router;
}

function dispatchOne(router: ProjectionRouter<Event>) {
  const event = createTestEvent(
    TEST_CONSTANTS.AGGREGATE_ID,
    aggregateType,
    tenantId,
    TEST_CONSTANTS.EVENT_TYPE_1,
    1000,
    "2025-12-17",
    {},
    "evt-drained",
  );
  return router.dispatch([event], readContext);
}

function loggedWith(spy: typeof warnSpy): unknown[][] {
  return spy.mock.calls.filter(([, message]) => message === DISPATCH_FAILED);
}

describe("ProjectionRouter dispatch failure log level", () => {
  beforeEach(() => {
    warnSpy.mockClear();
    errorSpy.mockClear();
  });

  describe("given a queue whose drain has finished during shutdown", () => {
    describe("when the router dispatches events to it", () => {
      /** @scenario A dispatch refused because the drain already ended is a warning */
      it("warns with the reason and still hands the events back for re-drive", async () => {
        const router = routerWhoseQueueRefuses(
          new QueueStagingClosedError({ queueName: "{event-sourcing/jobs}", operation: "send" }),
        );

        const failures = await dispatchOne(router);

        expect(failures).toMatchObject([{ kind: "subscriber", lane: "drainedSubscriber" }]);
        expect(loggedWith(errorSpy)).toEqual([]);
        expect(loggedWith(warnSpy)).toEqual([
          [expect.objectContaining({ reason: expect.stringContaining("drain") }), DISPATCH_FAILED],
        ]);
      });
    });
  });

  describe("given a queue that refuses a dispatch for any other reason", () => {
    describe("when the router dispatches events to it", () => {
      /** @scenario Any other dispatch failure is still an error */
      it("logs the failure at error level", async () => {
        const router = routerWhoseQueueRefuses(
          new GroupQueueError({
            queueName: "{event-sourcing/jobs}",
            operation: "send",
            message: "Redis connection lost",
          }),
        );

        const failures = await dispatchOne(router);

        expect(failures).toHaveLength(1);
        expect(loggedWith(warnSpy)).toEqual([]);
        expect(loggedWith(errorSpy)).toHaveLength(1);
      });
    });
  });
});
