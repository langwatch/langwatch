import { afterEach, describe, expect, it } from "vitest";
import { parseForkComparisonRate } from "../fork";

/**
 * The knob that decides how much of a cut-over organization's traffic runs
 * the detached legacy comparison. Its default is the OPPOSITE of the shadow
 * knob's - unset means every check compares, because the comparison is the
 * parity proof (D-PR3-2) - but the failure direction on a malformed value is
 * the same: the operator setting this knob is turning the double-read DOWN,
 * so an unreadable value must never buy the full rate back.
 */

const setRate = (value: string | undefined) => {
  if (value === undefined) {
    delete process.env.AUTHZ_FORK_COMPARISON_RATE;
    return;
  }
  process.env.AUTHZ_FORK_COMPARISON_RATE = value;
};

describe("parseForkComparisonRate", () => {
  const original = process.env.AUTHZ_FORK_COMPARISON_RATE;

  afterEach(() => {
    setRate(original);
  });

  describe("when the knob is unset or empty", () => {
    it("compares every check, which is the shipped default", () => {
      setRate(undefined);
      expect(parseForkComparisonRate()).toBe(1);
      setRate("");
      expect(parseForkComparisonRate()).toBe(1);
    });
  });

  describe("when the knob names every check", () => {
    it("reads 1 and true as the full rate", () => {
      setRate("1");
      expect(parseForkComparisonRate()).toBe(1);
      setRate("true");
      expect(parseForkComparisonRate()).toBe(1);
    });
  });

  describe("when the knob turns the comparison off", () => {
    it("reads 0 as off", () => {
      setRate("0");
      expect(parseForkComparisonRate()).toBe(0);
    });

    it('reads "off" as off, not as the full rate', () => {
      setRate("off");
      expect(parseForkComparisonRate()).toBe(0);
    });
  });

  describe("when the knob names a fraction", () => {
    it("keeps it, so a share of checks is compared", () => {
      setRate("0.25");
      expect(parseForkComparisonRate()).toBe(0.25);
    });

    it("clamps a value outside the unit range", () => {
      setRate("7");
      expect(parseForkComparisonRate()).toBe(1);
      setRate("-1");
      expect(parseForkComparisonRate()).toBe(0);
    });
  });

  describe("when the knob is malformed", () => {
    it("fails closed rather than comparing every check", () => {
      setRate("garbage");
      expect(parseForkComparisonRate()).toBe(0);
      setRate("0.5oops");
      expect(parseForkComparisonRate()).toBe(0);
      setRate("Infinity");
      expect(parseForkComparisonRate()).toBe(0);
    });
  });
});
