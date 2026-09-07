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

import {
  resolveRealDataState,
  sampleModeActive,
  settleRealDataState,
  summaryAsRead,
} from "../costSampleMode";

/** A headline summary in the wire shape, empty unless overridden. */
function summary(
  overrides: Partial<Parameters<typeof summaryAsRead>[0] & object> = {},
) {
  return {
    unavailableReason: null,
    billed: { amountUsd: null, cellsWithoutAmount: 0 },
    gateway: { amountUsd: null, cellsWithoutAmount: 0 },
    seats: { status: "awaiting_data" },
    ...overrides,
  };
}

describe("reading the headline summary as a real-data read", () => {
  describe("given the read has not answered", () => {
    it("stays an unanswered read", () => {
      expect(summaryAsRead(undefined)).toBeNull();
    });
  });

  describe("given the screen is structurally unavailable", () => {
    it("answers as measured and empty rather than waiting forever", () => {
      expect(
        summaryAsRead(summary({ unavailableReason: "no_cost_store" })),
      ).toEqual({ length: 0 });
    });
  });

  describe("given a pulled bill and nothing else", () => {
    it("counts as real data — a real bill must keep the invented panels off", () => {
      const read = summaryAsRead(
        summary({ billed: { amountUsd: 123.45, cellsWithoutAmount: 0 } }),
      );
      expect(resolveRealDataState([read])).toBe("present");
    });
  });

  describe("given a bill whose total is withheld for currency", () => {
    it("still counts as real data — withheld is not absent", () => {
      const read = summaryAsRead(
        summary({ billed: { amountUsd: null, cellsWithoutAmount: 4 } }),
      );
      expect(resolveRealDataState([read])).toBe("present");
    });
  });

  describe("given seat pools and no money", () => {
    it("counts as real data", () => {
      const read = summaryAsRead(
        summary({ seats: { status: "reported", pools: [{}] } }),
      );
      expect(resolveRealDataState([read])).toBe("present");
    });
  });

  describe("given every lane answered with nothing", () => {
    it("reads as measured and empty", () => {
      expect(resolveRealDataState([summaryAsRead(summary())])).toBe("absent");
    });
  });
});

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

describe("holding the answer across a gap in the reads", () => {
  describe("given the reads go unanswered again", () => {
    it("keeps the empty screen empty instead of forgetting it", () => {
      expect(settleRealDataState("absent", "unknown")).toBe("absent");
    });

    it("keeps real figures real instead of forgetting them", () => {
      expect(settleRealDataState("present", "unknown")).toBe("present");
    });
  });

  describe("given a later window answers", () => {
    it("takes the new answer over the held one", () => {
      expect(settleRealDataState("absent", "present")).toBe("present");
      expect(settleRealDataState("present", "absent")).toBe("absent");
    });
  });

  describe("given nothing has answered yet", () => {
    it("has nothing to hold", () => {
      expect(settleRealDataState("unknown", "unknown")).toBe("unknown");
    });
  });
});
