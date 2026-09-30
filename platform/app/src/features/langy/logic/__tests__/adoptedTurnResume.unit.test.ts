import { describe, expect, it } from "vitest";
import {
  shouldRefetchHistoryForAdoptedTurn,
  shouldResumeAdoptedTurn,
} from "../adoptedTurnResume";

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

const foldAhead = {
  turnActive: true,
  activeTurnId: "turn-9",
  dispatchedTurnId: "turn-8",
  foldInFlightTurnId: null,
  refetchedTurnId: null,
  hasHistory: true,
  isFetchingHistory: false,
} as const;

describe("shouldRefetchHistoryForAdoptedTurn", () => {
  it("re-reads the transcript when the fold names a turn the snapshot never saw", () => {
    expect(shouldRefetchHistoryForAdoptedTurn(foldAhead)).toBe(true);
  });

  it("never re-reads for the turn this tab's own send started", () => {
    expect(
      shouldRefetchHistoryForAdoptedTurn({
        ...foldAhead,
        dispatchedTurnId: "turn-9",
      }),
    ).toBe(false);
  });

  it("leaves a snapshot that already names the turn alone", () => {
    expect(
      shouldRefetchHistoryForAdoptedTurn({
        ...foldAhead,
        foldInFlightTurnId: "turn-9",
      }),
    ).toBe(false);
  });

  it("re-reads once per adopted turn", () => {
    expect(
      shouldRefetchHistoryForAdoptedTurn({
        ...foldAhead,
        refetchedTurnId: "turn-9",
      }),
    ).toBe(false);
    expect(
      shouldRefetchHistoryForAdoptedTurn({
        ...foldAhead,
        refetchedTurnId: "turn-8",
      }),
    ).toBe(true);
  });

  it("waits while no turn is in flight or the store tracks none", () => {
    expect(
      shouldRefetchHistoryForAdoptedTurn({ ...foldAhead, turnActive: false }),
    ).toBe(false);
    expect(
      shouldRefetchHistoryForAdoptedTurn({ ...foldAhead, activeTurnId: null }),
    ).toBe(false);
  });

  it("stays quiet while no transcript has been read for the conversation", () => {
    // Nothing is stale yet, and the first read is already on its way with the
    // turn in it.
    expect(
      shouldRefetchHistoryForAdoptedTurn({ ...foldAhead, hasHistory: false }),
    ).toBe(false);
  });

  it("waits for a transcript read already in flight to settle", () => {
    expect(
      shouldRefetchHistoryForAdoptedTurn({
        ...foldAhead,
        isFetchingHistory: true,
      }),
    ).toBe(false);
  });
});
