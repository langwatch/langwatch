import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { z } from "zod";
import {
  AbstractFoldProjection,
  type AnyEventSchema,
  type FoldEventHandlers,
} from "../abstractFoldProjection";
import type { FoldProjectionStore } from "../foldProjection.types";

// --- Test Zod schemas (mimic real event schemas) ---

const IncrementedEventSchema = z.object({
  type: z.literal("test.incremented"),
  amount: z.number(),
});
type IncrementedEvent = z.infer<typeof IncrementedEventSchema>;

const ResetEventSchema = z.object({
  type: z.literal("test.reset"),
});
type ResetEvent = z.infer<typeof ResetEventSchema>;

const testEvents = [IncrementedEventSchema, ResetEventSchema] as const;

// --- Test fixtures ---

interface TestState {
  value: string;
  count: number;
  CreatedAt: number;
  UpdatedAt: number;
}

const noopStore: FoldProjectionStore<TestState> = {
  store: async () => {},
  get: async () => null,
};

class TestFoldProjection
  extends AbstractFoldProjection<TestState, typeof testEvents>
  implements FoldEventHandlers<typeof testEvents, TestState>
{
  readonly name = "test";
  readonly version = "2026-01-01";
  readonly store = noopStore;

  protected readonly events = testEvents;

  protected initState() {
    return { value: "", count: 0 };
  }

  handleTestIncremented(event: IncrementedEvent, state: TestState): TestState {
    return { ...state, count: state.count + event.amount };
  }

  handleTestReset(_event: ResetEvent, state: TestState): TestState {
    return { ...state, count: 0, value: "reset" };
  }
}

// --- camelCase variant ---

interface CamelState {
  name: string;
  createdAt: number;
  updatedAt: number;
}

const CamelEventSchema = z.object({
  type: z.literal("test.camel_happened"),
});
type CamelEvent = z.infer<typeof CamelEventSchema>;

const camelEvents = [CamelEventSchema] as const;

class CamelFoldProjection
  extends AbstractFoldProjection<CamelState, typeof camelEvents>
  implements FoldEventHandlers<typeof camelEvents, CamelState>
{
  readonly name = "camel";
  readonly version = "2026-01-01";
  readonly store: FoldProjectionStore<CamelState> = {
    store: async () => {},
    get: async () => null,
  };
  protected override readonly timestampStyle = "camel" as const;

  protected readonly events = camelEvents;

  protected initState() {
    return { name: "" };
  }

  handleTestCamelHappened(
    _event: CamelEvent,
    state: CamelState,
  ): CamelState {
    return { ...state, name: "happened" };
  }
}

// --- Tests ---

describe("AbstractFoldProjection", () => {
  let projection: TestFoldProjection;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(1000);
    projection = new TestFoldProjection();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("when initializing state", () => {
    it("sets CreatedAt and UpdatedAt to Date.now()", () => {
      const state = projection.init();

      expect(state.CreatedAt).toBe(1000);
      expect(state.UpdatedAt).toBe(1000);
    });

    it("includes fields from initState()", () => {
      const state = projection.init();

      expect(state.value).toBe("");
      expect(state.count).toBe(0);
    });
  });

  describe("when applying a known event", () => {
    it("dispatches to the correct handler", () => {
      const state = projection.init();
      const event: IncrementedEvent = { type: "test.incremented", amount: 5 };

      const result = projection.apply(state, event);

      expect(result.count).toBe(5);
    });

    it("produces monotonic UpdatedAt", () => {
      const state = projection.init();

      const event: IncrementedEvent = { type: "test.incremented", amount: 1 };
      const s1 = projection.apply(state, event);

      expect(s1.UpdatedAt).toBe(1001); // max(1000, 1000 + 1) = 1001

      const s2 = projection.apply(s1, event);

      expect(s2.UpdatedAt).toBe(1002); // max(1000, 1001 + 1) = 1002
    });

    it("uses Date.now() when it exceeds previous + 1", () => {
      const state = projection.init();
      const event: IncrementedEvent = { type: "test.incremented", amount: 1 };

      vi.setSystemTime(5000);
      const result = projection.apply(state, event);

      expect(result.UpdatedAt).toBe(5000); // max(5000, 1000 + 1) = 5000
    });
  });

  describe("when applying an unknown event", () => {
    it("returns state unchanged", () => {
      const state = projection.init();

      const result = projection.apply(state, { type: "unknown.event" });

      expect(result).toBe(state);
    });
  });

  describe("when eventTypes is accessed", () => {
    it("derives from event schemas", () => {
      expect(projection.eventTypes).toEqual([
        "test.incremented",
        "test.reset",
      ]);
    });
  });

  describe("when using camelCase timestamps", () => {
    it("sets createdAt and updatedAt on init", () => {
      const camel = new CamelFoldProjection();
      const state = camel.init();

      expect(state.createdAt).toBe(1000);
      expect(state.updatedAt).toBe(1000);
    });

    it("produces monotonic updatedAt on apply", () => {
      const camel = new CamelFoldProjection();
      const state = camel.init();

      const result = camel.apply(state, { type: "test.camel_happened" });

      expect(result.updatedAt).toBe(1001);
      expect(result.name).toBe("happened");
    });
  });
});
