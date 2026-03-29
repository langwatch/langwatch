import { describe, expect, it } from "vitest";
import { z } from "zod";
import { AbstractFoldProjection, type FoldEventHandlers } from "../projections/abstractFoldProjection";
import { AbstractMapProjection, type MapEventHandlers } from "../projections/abstractMapProjection";
import type { FoldProjectionStore } from "../projections/foldProjection.types";
import type { AppendStore } from "../projections/mapProjection.types";

const testEventSchema = z.object({
  id: z.string(),
  aggregateId: z.string(),
  aggregateType: z.literal("test_aggregate"),
  tenantId: z.string(),
  createdAt: z.number(),
  occurredAt: z.number(),
  type: z.literal("lw.test.item_added"),
  version: z.string(),
  data: z.object({ item: z.string() }),
});

const testEvents = [testEventSchema] as const;
type TestEvent = z.infer<typeof testEventSchema>;

interface TestFoldState {
  count: number;
  CreatedAt: number;
  UpdatedAt: number;
}

class TestFoldProjection
  extends AbstractFoldProjection<TestFoldState, typeof testEvents>
  implements FoldEventHandlers<typeof testEvents, TestFoldState>
{
  readonly name = "testFold";
  readonly version = "2026-03-29";
  readonly store: FoldProjectionStore<TestFoldState> = {
    get: async () => null,
    store: async () => {},
  };
  protected readonly events = testEvents;

  protected initState() {
    return { count: 0 };
  }

  handleTestItemAdded(_event: TestEvent, state: TestFoldState): TestFoldState {
    return { ...state, count: state.count + 1 };
  }
}

class TestMapProjection
  extends AbstractMapProjection<{ id: string }, typeof testEvents>
  implements MapEventHandlers<typeof testEvents, { id: string }>
{
  readonly name = "testMap";
  readonly store: AppendStore<{ id: string }> = { append: async () => {} };
  protected readonly events = testEvents;

  mapTestItemAdded(_event: TestEvent): { id: string } | null {
    return { id: "1" };
  }
}

describe("AbstractFoldProjection and AbstractMapProjection getter preservation", () => {
  describe("when class instance is used directly", () => {
    it("eventTypes getter works on fold projection", () => {
      const fold = new TestFoldProjection();
      expect(fold.eventTypes).toEqual(["lw.test.item_added"]);
    });

    it("eventTypes getter works on map projection", () => {
      const map = new TestMapProjection();
      expect(map.eventTypes).toEqual(["lw.test.item_added"]);
    });
  });

  describe("when class instance is spread into a plain object", () => {
    it("eventTypes getter is lost on fold projection", () => {
      const fold = new TestFoldProjection();
      const spread = { ...fold };

      // This is the bug: spreading loses the prototype getter
      expect((spread as any).eventTypes).toBeUndefined();
    });

    it("eventTypes getter is lost on map projection", () => {
      const map = new TestMapProjection();
      const spread = { ...map };

      expect((spread as any).eventTypes).toBeUndefined();
    });
  });
});
