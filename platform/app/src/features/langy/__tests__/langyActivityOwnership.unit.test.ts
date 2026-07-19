import { describe, expect, it } from "vitest";
import {
  formatLangyPreviewCount,
  formatLangyProgressCount,
  resolveLangyActivityOwnership,
} from "../logic/langyActivityOwnership";

const progressSample = {
  current: 24,
  total: 80,
  receivedAtMs: 100,
  batchItems: 12,
  batchDurationMs: 50,
};

describe("resolveLangyActivityOwnership", () => {
  it("lets a pending capability card own progress and silence the wave pulse", () => {
    const presentation = resolveLangyActivityOwnership({
      hasInlineProgressOwner: true,
      turnInFlight: true,
      status: "Searching traces…",
      progress: 30,
      progressSample,
      metricsCount: 0,
    });

    expect(presentation).toEqual({
      standaloneStatus: null,
      standaloneProgress: null,
      standaloneProgressSample: null,
      showStandaloneSignals: false,
      waveStatusActive: false,
    });
  });

  it("keeps turn-wide metrics without repeating the card's status or bar", () => {
    const presentation = resolveLangyActivityOwnership({
      hasInlineProgressOwner: true,
      turnInFlight: true,
      status: "Searching traces…",
      progress: 30,
      progressSample,
      metricsCount: 2,
    });

    expect(presentation.showStandaloneSignals).toBe(true);
    expect(presentation.standaloneStatus).toBeNull();
    expect(presentation.standaloneProgress).toBeNull();
    expect(presentation.waveStatusActive).toBe(false);
  });

  it("keeps the standalone status and pulse when there is no inline owner", () => {
    const presentation = resolveLangyActivityOwnership({
      hasInlineProgressOwner: false,
      turnInFlight: true,
      status: "Searching traces…",
      progress: 30,
      progressSample,
      metricsCount: 0,
    });

    expect(presentation.standaloneStatus).toBe("Searching traces…");
    expect(presentation.standaloneProgress).toBe(30);
    expect(presentation.standaloneProgressSample).toBe(progressSample);
    expect(presentation.showStandaloneSignals).toBe(true);
    expect(presentation.waveStatusActive).toBe(true);
  });

  it("keeps measured and loaded counts on the capability card", () => {
    expect(formatLangyProgressCount({ current: 1_204, total: 4_901 })).toBe(
      "1,204 of 4,901",
    );
    expect(formatLangyPreviewCount({ loadedCount: 5, totalCount: 58 })).toBe(
      "58 matches · 5 shown",
    );
    expect(formatLangyPreviewCount({ loadedCount: 5, totalCount: null })).toBe(
      "5 shown so far",
    );
  });
});
