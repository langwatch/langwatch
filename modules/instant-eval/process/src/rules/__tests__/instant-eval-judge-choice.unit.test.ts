/**
 * Which judge a deployment judges with, from its classifier setting and whether it holds a key.
 * @see specs/self-hosting/connected-services/connect-settings.feature
 * @see specs/instant-evals/classifier.feature
 */

import { InstantEvalMemoryJudgeInProductionError } from "@langwatch/instant-eval-contract";
import { describe, expect, it } from "vitest";

import { instantEvalJudgeKind } from "../instant-eval-judge-choice.rules.ts";

describe("instantEvalJudgeKind", () => {
  /** @scenario "An install with its own judge key keeps using it" */
  it("judges with the install's own key whenever it holds one", () => {
    expect(
      instantEvalJudgeKind({ classifier: undefined, hasOwnKey: true, isProduction: false }),
    ).toBe("own_key");
    expect(instantEvalJudgeKind({ classifier: "jev", hasOwnKey: true, isProduction: false })).toBe(
      "own_key",
    );
  });

  it("judges through Connect where the install holds no key", () => {
    expect(
      instantEvalJudgeKind({ classifier: undefined, hasOwnKey: false, isProduction: false }),
    ).toBe("connect");
    expect(instantEvalJudgeKind({ classifier: "jev", hasOwnKey: false, isProduction: false })).toBe(
      "connect",
    );
  });

  it("judges through Connect when the operator names it, key or not", () => {
    expect(
      instantEvalJudgeKind({ classifier: "connect", hasOwnKey: true, isProduction: false }),
    ).toBe("connect");
  });

  it("judges nothing when the operator names the null classifier", () => {
    expect(instantEvalJudgeKind({ classifier: "null", hasOwnKey: true, isProduction: false })).toBe(
      "none",
    );
  });

  /** @scenario "A deployment that names the memory classifier judges with the deterministic stand-in" */
  it("judges with the memory stand-in when the operator names it outside production", () => {
    for (const hasOwnKey of [true, false]) {
      expect(instantEvalJudgeKind({ classifier: "memory", hasOwnKey, isProduction: false })).toBe(
        "memory",
      );
    }
  });

  /** @scenario "A production process refuses to boot on the memory judge" */
  it("refuses the memory stand-in in production", () => {
    expect(() =>
      instantEvalJudgeKind({ classifier: "memory", hasOwnKey: false, isProduction: true }),
    ).toThrow(InstantEvalMemoryJudgeInProductionError);
  });
});
