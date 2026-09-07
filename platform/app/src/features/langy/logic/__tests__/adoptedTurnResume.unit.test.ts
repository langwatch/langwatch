import { describe, expect, it } from "vitest";
import { shouldResumeAdoptedTurn } from "../adoptedTurnResume";

/**
 * @see specs/langy/langy-frontend-realtime.feature
 */
const adopted = {
  turnActive: true,
  activeTurnId: "turn-9",
  dispatchedTurnId: null,
  resumedTurnId: null,
  isStreaming: false,
  isHistoryLoadPending: false,
  lastEngineRole: "user",
} as const;

describe("shouldResumeAdoptedTurn", () => {
  it("resumes a turn the durable record named that this tab never dispatched", () => {
    expect(shouldResumeAdoptedTurn(adopted)).toBe(true);
  });

  it("never resumes the turn this tab's own send started", () => {
    expect(
      shouldResumeAdoptedTurn({ ...adopted, dispatchedTurnId: "turn-9" }),
    ).toBe(false);
  });

  it("resumes each adopted turn once", () => {
    expect(
      shouldResumeAdoptedTurn({ ...adopted, resumedTurnId: "turn-9" }),
    ).toBe(false);
    expect(
      shouldResumeAdoptedTurn({ ...adopted, resumedTurnId: "turn-8" }),
    ).toBe(true);
  });

  it("waits while no turn is in flight or the store tracks none", () => {
    expect(shouldResumeAdoptedTurn({ ...adopted, turnActive: false })).toBe(
      false,
    );
    expect(shouldResumeAdoptedTurn({ ...adopted, activeTurnId: null })).toBe(
      false,
    );
  });

  it("waits while the engine is already streaming", () => {
    expect(shouldResumeAdoptedTurn({ ...adopted, isStreaming: true })).toBe(
      false,
    );
  });

  it("waits for a pending history load to own the engine first", () => {
    expect(
      shouldResumeAdoptedTurn({ ...adopted, isHistoryLoadPending: true }),
    ).toBe(false);
  });

  it("waits until the turn's own user message is the last one in the engine", () => {
    // The resumed stream would write into a trailing assistant message and
    // append this turn's words to the previous reply.
    expect(
      shouldResumeAdoptedTurn({ ...adopted, lastEngineRole: "assistant" }),
    ).toBe(false);
    expect(shouldResumeAdoptedTurn({ ...adopted, lastEngineRole: null })).toBe(
      false,
    );
  });
});
