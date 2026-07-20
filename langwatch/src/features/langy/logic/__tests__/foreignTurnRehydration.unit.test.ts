import { describe, expect, it } from "vitest";
import { shouldRehydrateEngineFromDurable } from "../foreignTurnRehydration";

// A steady-state, idle, active conversation whose durable fold has grown past
// the engine — the case that MUST re-hydrate. Each test overrides one field to
// prove a single guard.
const rehydrating = {
  historyLoadPending: false,
  isStreaming: false,
  isFetchingHistory: false,
  hasActiveConversation: true,
  durableMessageCount: 2,
  engineMessageCount: 0,
} as const;

describe("shouldRehydrateEngineFromDurable", () => {
  describe("given an idle open conversation whose durable fold has grown", () => {
    it("re-hydrates the engine", () => {
      expect(shouldRehydrateEngineFromDurable(rehydrating)).toBe(true);
    });
  });

  describe("when a user selection is loading", () => {
    it("defers to the selection effect and does not re-hydrate", () => {
      expect(
        shouldRehydrateEngineFromDurable({
          ...rehydrating,
          historyLoadPending: true,
        }),
      ).toBe(false);
    });
  });

  describe("when a live self-driven turn is streaming", () => {
    it("leaves the engine to the live stream", () => {
      expect(
        shouldRehydrateEngineFromDurable({
          ...rehydrating,
          isStreaming: true,
        }),
      ).toBe(false);
    });
  });

  describe("when the durable messages query is mid-refetch", () => {
    it("waits for fresh data before comparing", () => {
      expect(
        shouldRehydrateEngineFromDurable({
          ...rehydrating,
          isFetchingHistory: true,
        }),
      ).toBe(false);
    });
  });

  describe("when no conversation is open", () => {
    it("does not re-hydrate", () => {
      expect(
        shouldRehydrateEngineFromDurable({
          ...rehydrating,
          hasActiveConversation: false,
        }),
      ).toBe(false);
    });
  });

  describe("given the durable fold is not ahead of the engine", () => {
    describe("when the counts are equal", () => {
      it("does not re-hydrate", () => {
        expect(
          shouldRehydrateEngineFromDurable({
            ...rehydrating,
            durableMessageCount: 2,
            engineMessageCount: 2,
          }),
        ).toBe(false);
      });
    });

    describe("when the durable fold is momentarily behind the engine", () => {
      it("never shrinks the engine, avoiding the settle-boundary flash", () => {
        expect(
          shouldRehydrateEngineFromDurable({
            ...rehydrating,
            durableMessageCount: 1,
            engineMessageCount: 2,
          }),
        ).toBe(false);
      });
    });
  });
});
