import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { EventSchema } from "../../domain/types";
import {
  AbstractMapProjection,
  type MapEventHandlers,
} from "../abstractMapProjection";
import type { AppendStore } from "../mapProjection.types";

// Test schemas
const fooEventSchema = EventSchema.extend({
  type: z.literal("lw.test.foo_happened"),
  data: z.object({ value: z.number() }),
});
type FooEvent = z.infer<typeof fooEventSchema>;

const barEventSchema = EventSchema.extend({
  type: z.literal("lw.test.bar_happened"),
  data: z.object({ label: z.string() }),
});
type BarEvent = z.infer<typeof barEventSchema>;

interface TestRecord {
  id: string;
  payload: string;
}

const testEvents = [fooEventSchema, barEventSchema] as const;

class TestMapProjection
  extends AbstractMapProjection<TestRecord, typeof testEvents>
  implements MapEventHandlers<typeof testEvents, TestRecord>
{
  readonly name = "testMap";
  readonly store: AppendStore<TestRecord>;
  protected readonly events = testEvents;

  constructor(store: AppendStore<TestRecord>) {
    super();
    this.store = store;
  }

  mapTestFooHappened(event: FooEvent): TestRecord {
    return { id: `foo-${event.data.value}`, payload: `val:${event.data.value}` };
  }

  mapTestBarHappened(event: BarEvent): TestRecord | null {
    if (event.data.label === "skip") return null;
    return { id: `bar-${event.data.label}`, payload: `lbl:${event.data.label}` };
  }
}

function makeEvent(type: string, data: Record<string, unknown>): any {
  return {
    id: "evt-1",
    aggregateId: "agg-1",
    aggregateType: "test_aggregate",
    tenantId: "tenant-1",
    createdAt: 1700000000000,
    occurredAt: 1700000000000,
    type,
    version: "2026-01-01",
    data,
  };
}

describe("AbstractMapProjection", () => {
  const mockStore: AppendStore<TestRecord> = {
    append: vi.fn(),
  };

  describe("eventTypes", () => {
    it("derives event types from schemas", () => {
      const projection = new TestMapProjection(mockStore);
      expect(projection.eventTypes).toEqual([
        "lw.test.foo_happened",
        "lw.test.bar_happened",
      ]);
    });
  });

  describe("map()", () => {
    it("dispatches to the correct typed handler", () => {
      const projection = new TestMapProjection(mockStore);
      const result = projection.map(makeEvent("lw.test.foo_happened", { value: 42 }));
      expect(result).toEqual({ id: "foo-42", payload: "val:42" });
    });

    it("dispatches to bar handler", () => {
      const projection = new TestMapProjection(mockStore);
      const result = projection.map(makeEvent("lw.test.bar_happened", { label: "hello" }));
      expect(result).toEqual({ id: "bar-hello", payload: "lbl:hello" });
    });

    it("returns null when handler returns null", () => {
      const projection = new TestMapProjection(mockStore);
      const result = projection.map(makeEvent("lw.test.bar_happened", { label: "skip" }));
      expect(result).toBeNull();
    });

    it("returns null for unrecognized event types", () => {
      const projection = new TestMapProjection(mockStore);
      const result = projection.map(makeEvent("lw.test.unknown", {}));
      expect(result).toBeNull();
    });
  });
});
