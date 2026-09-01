/**
 * The two rules behind the sample panels' visibility, tested directly because
 * the interesting case is one the page cannot easily be put into: reads that
 * land at different times.
 *
 * Four reads answer independently, so mid-load the page holds a mix of rows
 * and nulls. Reading that mix as "nothing measured" would flash the sample
 * panels onto a screen that is about to fill with real figures — the exact
 * flicker the `unknown` state exists to prevent.
 */
import { describe, expect, it } from "vitest";

import { resolveRealDataState, sampleModeActive } from "../costSampleMode";

describe("reading the real cost reads", () => {
  describe("given every read has answered with rows", () => {
    it("reports the organization has real figures", () => {
      expect(resolveRealDataState([[1], [1]])).toBe("present");
    });
  });

  describe("given one read holds rows and another has not answered", () => {
    it("reports figures rather than waiting on the slower read", () => {
      expect(resolveRealDataState([[1], null])).toBe("present");
    });
  });

  describe("given one read answered empty and another has not answered", () => {
    it("withholds a verdict, since the pending read may hold the figures", () => {
      expect(resolveRealDataState([[], null])).toBe("unknown");
    });
  });

  describe("given every read answered and all are empty", () => {
    it("reports the screen as measured and empty", () => {
      expect(resolveRealDataState([[], []])).toBe("absent");
    });
  });
});

describe("deciding whether the sample panels render", () => {
  describe("given the reader has not touched the toggle", () => {
    it("fills an empty screen", () => {
      expect(sampleModeActive({ optIn: null, realData: "absent" })).toBe(true);
    });

    it("stays out of the way of real figures", () => {
      expect(sampleModeActive({ optIn: null, realData: "present" })).toBe(
        false,
      );
    });

    it("waits rather than guessing while a read is in flight", () => {
      expect(sampleModeActive({ optIn: null, realData: "unknown" })).toBe(
        false,
      );
    });
  });

  describe("given the reader has chosen", () => {
    it("shows the panels over real figures when they asked for them", () => {
      expect(sampleModeActive({ optIn: true, realData: "present" })).toBe(true);
    });

    it("leaves an empty screen empty when they turned them off", () => {
      expect(sampleModeActive({ optIn: false, realData: "absent" })).toBe(
        false,
      );
    });
  });
});
