/**
 * @vitest-environment node
 *
 * Regression: the outbox runtime must reach the reactors it feeds.
 *
 * The trigger-dispatch outage (every worker logging "no outbox runtime is
 * wired" and dropping the dispatch) was a composition-root wiring bug —
 * `presets.ts` constructed the EventSourcing runtime BEFORE the outbox and
 * handed the outbox to a different object, so `EventSourcing._outbox` stayed
 * undefined and every `.withOutbox` reactor was adapted onto the silent drop
 * path.
 *
 * This unit test locks the EventSourcing side of that contract: an instance
 * constructed WITH an outbox adapts its `.withOutbox` reactors to the live
 * dispatch path (`isOutboxWired` true, no registration drop-warning); one
 * constructed WITHOUT it drops (`isOutboxWired` false, drop-warning fires at
 * registration). The composition root that must actually pass the outbox in is
 * covered by presets.outboxWiring.integration.test.ts.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

// Shared logger stub so the adapter's `createLogger(...).warn(...)` funnels into
// one spy we can assert on. The adapter emits the drop-warning synchronously at
// registration time when no outbox runtime is present.
const { warnSpy } = vi.hoisted(() => ({ warnSpy: vi.fn() }));
vi.mock("~/utils/logger/server", () => {
  const logger = {
    trace: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
    warn: warnSpy,
    error: vi.fn(),
    fatal: vi.fn(),
    child: () => logger,
  };
  return { createLogger: () => logger };
});

import type { Event } from "../../domain/types";
import { EventSourcing } from "../../eventSourcing";
import { createMockFoldProjection } from "../../pipeline/__tests__/testHelpers";
import { definePipeline } from "../../pipeline/staticBuilder";
import type { OutboxReactorDefinition } from "../outboxReactor.types";
import type { OutboxRuntime } from "../setup";

const DROP_WARNING = "registered without an outbox runtime";

function makeOutboxStub(): OutboxRuntime {
  return {
    dispatcher: { process: vi.fn(), processBatch: vi.fn() } as any,
    auditAdapter: {} as any,
    attachQueue: vi.fn(),
    enqueueSettle: vi.fn().mockResolvedValue(undefined),
  };
}

/** A minimal pipeline whose single reactor is registered via `.withOutbox`, so
 *  registering it forces the runtime to adapt an outbox reactor (the exact code
 *  path that regressed). */
function pipelineWithOutboxReactor() {
  const fold = createMockFoldProjection({ name: "testFold" });
  const reactor: OutboxReactorDefinition<Event> = {
    name: "testOutboxReactor",
    decide: async () => [],
  };
  return definePipeline<Event>()
    .withName("outbox-wiring-test")
    .withAggregateType("trace")
    .withFoldProjection("testFold", fold as any)
    .withOutbox("testFold", "testOutboxReactor", reactor)
    .build();
}

function dropWarningFired(): boolean {
  return warnSpy.mock.calls.some((args) =>
    args.some((arg) => typeof arg === "string" && arg.includes(DROP_WARNING)),
  );
}

describe("EventSourcing outbox wiring", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("when constructed with an outbox runtime", () => {
    it("reports the outbox as wired", () => {
      const es = new EventSourcing({ enabled: true, outbox: makeOutboxStub() });

      expect(es.isOutboxWired).toBe(true);
    });

    it("adapts .withOutbox reactors to the live path, not the drop path", () => {
      const es = new EventSourcing({ enabled: true, outbox: makeOutboxStub() });

      es.register(pipelineWithOutboxReactor());

      expect(dropWarningFired()).toBe(false);
    });
  });

  describe("when constructed without an outbox runtime", () => {
    it("reports the outbox as not wired", () => {
      const es = new EventSourcing({ enabled: true });

      expect(es.isOutboxWired).toBe(false);
    });

    it("adapts .withOutbox reactors to the drop path, warning at registration", () => {
      const es = new EventSourcing({ enabled: true });

      es.register(pipelineWithOutboxReactor());

      expect(dropWarningFired()).toBe(true);
    });
  });
});
