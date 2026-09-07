import { describe, expect, it } from "vitest";
import { VoiceConcurrencyGate } from "../voice-concurrency-gate";

describe("VoiceConcurrencyGate", () => {
  describe("when the cap is 2", () => {
    it("admits up to the cap per project, then blocks", () => {
      const gate = new VoiceConcurrencyGate({ max: 2 });
      const project = "proj-1";

      expect(gate.canAcquire(project)).toBe(true);
      gate.acquire(project);
      expect(gate.canAcquire(project)).toBe(true);
      gate.acquire(project);

      expect(gate.activeCount(project)).toBe(2);
      expect(gate.canAcquire(project)).toBe(false);
    });

    it("admits another once a slot is released", () => {
      const gate = new VoiceConcurrencyGate({ max: 2 });
      const project = "proj-1";
      gate.acquire(project);
      gate.acquire(project);

      gate.release(project);

      expect(gate.canAcquire(project)).toBe(true);
      expect(gate.activeCount(project)).toBe(1);
    });
  });

  describe("when two projects run concurrently", () => {
    it("caps each project independently", () => {
      const gate = new VoiceConcurrencyGate({ max: 2 });
      gate.acquire("a");
      gate.acquire("a");

      expect(gate.canAcquire("a")).toBe(false);
      expect(gate.canAcquire("b")).toBe(true);
      expect(gate.activeCount("b")).toBe(0);
    });
  });

  describe("when released below zero", () => {
    it("clamps at zero rather than going negative", () => {
      const gate = new VoiceConcurrencyGate({ max: 2 });
      gate.release("a");
      expect(gate.activeCount("a")).toBe(0);
    });
  });
});
