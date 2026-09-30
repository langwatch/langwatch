/**
 * Which judge a deployment judges with, from its classifier setting and whether it holds a key.
 * @see specs/self-hosting/connected-services/connect-settings.feature
 */

import { describe, expect, it } from "vitest";

import { instantEvalJudgeKind } from "../instant-eval-judge-choice.rules.ts";

describe("instantEvalJudgeKind", () => {
  /** @scenario "An install with its own judge key keeps using it" */
  it("judges with the install's own key whenever it holds one", () => {
    expect(instantEvalJudgeKind({ classifier: undefined, hasOwnKey: true })).toBe("own_key");
    expect(instantEvalJudgeKind({ classifier: "jev", hasOwnKey: true })).toBe("own_key");
  });

  it("judges through Connect where the install holds no key", () => {
    expect(instantEvalJudgeKind({ classifier: undefined, hasOwnKey: false })).toBe("connect");
    expect(instantEvalJudgeKind({ classifier: "jev", hasOwnKey: false })).toBe("connect");
  });

  it("judges through Connect when the operator names it, key or not", () => {
    expect(instantEvalJudgeKind({ classifier: "connect", hasOwnKey: true })).toBe("connect");
  });

  it("judges nothing when the operator names the null classifier", () => {
    expect(instantEvalJudgeKind({ classifier: "null", hasOwnKey: true })).toBe("none");
  });
});
