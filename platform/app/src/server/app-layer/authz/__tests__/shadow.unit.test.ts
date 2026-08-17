import { afterEach, describe, expect, it } from "vitest";
import { parseShadowRate } from "../shadow";

/**
 * The knob that decides how much traffic the engine shadows. Nothing it
 * returns can change a response, so the only failure that matters is reading
 * a value as MORE comparison than was asked for: a typo must never turn into
 * "compare every check" on a production box.
 */

const setRate = (value: string | undefined) => {
  if (value === undefined) {
    delete process.env.AUTHZ_V2_SHADOW;
    return;
  }
  process.env.AUTHZ_V2_SHADOW = value;
};

describe("parseShadowRate", () => {
  const original = process.env.AUTHZ_V2_SHADOW;

  afterEach(() => {
    setRate(original);
  });

  describe("when the knob names every check", () => {
    it("reads 1 and true as the full sample", () => {
      setRate("1");
      expect(parseShadowRate()).toBe(1);
      setRate("true");
      expect(parseShadowRate()).toBe(1);
    });
  });

  describe("when the knob names a fraction", () => {
    it("keeps it, so a share of traffic is compared", () => {
      setRate("0.25");
      expect(parseShadowRate()).toBe(0.25);
    });

    it("clamps a value outside the unit range", () => {
      setRate("7");
      expect(parseShadowRate()).toBe(1);
      setRate("-3");
      expect(parseShadowRate()).toBe(0);
    });
  });

  describe("when the knob is malformed", () => {
    // parseFloat("1oops") is 1: a typo would have read as "compare EVERY
    // check". The failure direction has to be no comparison, never more.
    it("reads a number with trailing junk as off, not as the leading digits", () => {
      setRate("1oops");
      expect(parseShadowRate()).toBe(0);
    });

    it("reads prose and an unbounded value as off", () => {
      setRate("yes please");
      expect(parseShadowRate()).toBe(0);
      setRate("Infinity");
      expect(parseShadowRate()).toBe(0);
    });
  });

  describe("when the knob is unset or empty", () => {
    it("is off, which is the shipped default", () => {
      setRate(undefined);
      expect(parseShadowRate()).toBe(0);
      setRate("");
      expect(parseShadowRate()).toBe(0);
    });
  });
});
