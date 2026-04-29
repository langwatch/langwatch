import { describe, expect, it } from "vitest";
import { EventBus } from "../../src/services/event-bus.ts";

describe("EventBus", () => {
  describe("when events are emitted before iteration starts", () => {
    it("buffers them and replays in order on the first iterator pass", async () => {
      const bus = new EventBus();
      bus.emit({ type: "starting", service: "postgres" });
      bus.emit({ type: "starting", service: "redis" });

      const it = bus[Symbol.asyncIterator]();
      expect((await it.next()).value).toMatchObject({ type: "starting", service: "postgres" });
      expect((await it.next()).value).toMatchObject({ type: "starting", service: "redis" });
    });
  });

  describe("when a consumer is awaiting next() before the producer emits", () => {
    it("delivers the event directly to the waiter", async () => {
      const bus = new EventBus();
      const it = bus[Symbol.asyncIterator]();
      const pending = it.next();

      bus.emit({ type: "healthy", service: "postgres", durationMs: 1200 });
      const result = await pending;
      expect(result.done).toBe(false);
      expect(result.value).toMatchObject({ type: "healthy", durationMs: 1200 });
    });
  });

  describe("when end() is called", () => {
    it("resolves every pending consumer with done:true", async () => {
      const bus = new EventBus();
      const it = bus[Symbol.asyncIterator]();
      const pending = it.next();

      bus.end();
      const result = await pending;
      expect(result.done).toBe(true);
    });

    it("makes subsequent emits no-op", async () => {
      const bus = new EventBus();
      bus.end();
      bus.emit({ type: "starting", service: "postgres" });
      const it = bus[Symbol.asyncIterator]();
      const result = await it.next();
      expect(result.done).toBe(true);
    });
  });

  describe("when an iterator's return() is called", () => {
    it("ends the bus and unblocks every other waiter", async () => {
      const bus = new EventBus();
      const it = bus[Symbol.asyncIterator]();
      const pending = it.next();
      await it.return?.();
      const result = await pending;
      expect(result.done).toBe(true);
    });
  });
});
