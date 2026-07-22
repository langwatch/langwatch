/**
 * Spec: specs/langy/langy-context-awareness.feature
 *   "Everything armed twinkles rather than pulsing in formation"
 *
 * The armed ring's colour is modulated by an animated REGISTERED custom
 * property (`@property` + var() references inside keyframes). Where that
 * animation doesn't run, the colour falls back to whatever the cascade says —
 * and it used to say `transparent`, so arming the page visibly did nothing.
 * These tests pin the fix: every lit state carries a static, visible baseline
 * colour of its own, independent of the animation.
 */
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { describe, expect, it } from "vitest";

const css = readFileSync(
  fileURLToPath(new URL("../langyContextTarget.css", import.meta.url)),
  "utf8",
);

/** The body of the first rule whose selector line contains `selector`. */
const ruleBody = (selector: string) => {
  const start = css.indexOf(selector);
  expect(start).toBeGreaterThan(-1);
  return css.slice(start, css.indexOf("}", start));
};

describe("the armed ring stylesheet", () => {
  describe("given a browser where the @property shimmer cannot run", () => {
    it("still paints the ring: every lit state sets a static baseline colour", () => {
      // `near` and `hover` used to get their colour ONLY from the keyframes;
      // without the animation the base class's transparent won and the armed
      // page highlighted nothing. The baseline must live outside @keyframes.
      expect(ruleBody(".langy-target[data-langy-target-state] {")).toContain(
        "--langy-target-color: var(--langy-target-near-2)",
      );
      expect(
        ruleBody('.langy-target[data-langy-target-state="hover"] {'),
      ).toContain("--langy-target-color: var(--langy-target-hover-2)");
      expect(
        ruleBody('.langy-target[data-langy-target-state="added"] {'),
      ).toContain("--langy-target-color: var(--langy-target-added)");
    });
  });

  describe("given the shimmer is running", () => {
    it("never fades a lit target to the invisible: no keyframe stop drops below legibility", () => {
      // The old trough was 0.03 alpha on a 1px hairline — invisible on a real
      // monitor, which read as "arming does nothing". Quiet is the brief;
      // invisible is a bug. Every near/hover stop must stay at or above 0.15.
      const stops = [...css.matchAll(/--langy-target-(?:near|hover)-\d:\s*rgba\([^)]*,\s*([\d.]+)\)/g)];
      expect(stops.length).toBeGreaterThan(0);
      for (const [declaration, alpha] of stops) {
        expect(Number(alpha), declaration).toBeGreaterThanOrEqual(0.15);
      }
    });
  });
});
