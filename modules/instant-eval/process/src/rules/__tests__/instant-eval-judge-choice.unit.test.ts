/**
 * Which judge a deployment judges with, from its classifier setting and whether it holds a key.
 * @see specs/self-hosting/connected-services/connect-settings.feature
 * @see modules/instant-eval/specs/classifier.feature
 */

import { InstantEvalMemoryJudgeInProductionError } from "@langwatch/instant-eval-contract";
import { describe, expect, it } from "vitest";

import {
  instantEvalJudgeKind,
  instantEvalJudgeRoute,
  isInstantEvalJudgeChosenOnFirstCall,
} from "../instant-eval-judge-choice.rules.ts";

describe("isInstantEvalJudgeChosenOnFirstCall", () => {
  it("waits for the first call where the key decides", () => {
    expect(isInstantEvalJudgeChosenOnFirstCall({ classifier: undefined })).toBe(true);
    expect(isInstantEvalJudgeChosenOnFirstCall({ classifier: "jev" })).toBe(true);
  });

  it("chooses at startup where the operator named the judge", () => {
    for (const classifier of ["connect", "null", "memory"] as const) {
      expect(isInstantEvalJudgeChosenOnFirstCall({ classifier })).toBe(false);
    }
  });
});

describe("instantEvalJudgeKind", () => {
  it("judges with LangWatch's key on LangWatch Cloud", () => {
    expect(
      instantEvalJudgeKind({ classifier: undefined, hasCloudKey: true, isProduction: false }),
    ).toBe("cloud");
    expect(
      instantEvalJudgeKind({ classifier: "jev", hasCloudKey: true, isProduction: false }),
    ).toBe("cloud");
  });

  it("judges through Connect where the judge holds no cloud key", () => {
    expect(
      instantEvalJudgeKind({ classifier: undefined, hasCloudKey: false, isProduction: false }),
    ).toBe("connect");
    expect(
      instantEvalJudgeKind({ classifier: "jev", hasCloudKey: false, isProduction: false }),
    ).toBe("connect");
  });

  it("judges through Connect when the operator names it, key or not", () => {
    expect(
      instantEvalJudgeKind({ classifier: "connect", hasCloudKey: true, isProduction: false }),
    ).toBe("connect");
  });

  it("judges nothing when the operator names the null classifier", () => {
    expect(
      instantEvalJudgeKind({ classifier: "null", hasCloudKey: true, isProduction: false }),
    ).toBe("none");
  });

  /** @scenario "A deployment that names the memory classifier judges with the deterministic stand-in" */
  it("judges with the memory stand-in when the operator names it outside production", () => {
    for (const hasCloudKey of [true, false]) {
      expect(instantEvalJudgeKind({ classifier: "memory", hasCloudKey, isProduction: false })).toBe(
        "memory",
      );
    }
  });

  /** @scenario "A production process refuses to boot on the memory judge" */
  it("refuses the memory stand-in in production", () => {
    expect(() =>
      instantEvalJudgeKind({ classifier: "memory", hasCloudKey: false, isProduction: true }),
    ).toThrow(InstantEvalMemoryJudgeInProductionError);
  });
});

describe("instantEvalJudgeRoute", () => {
  it("names the route a refusal reads, from the judge and whether Connect may call out", () => {
    expect(instantEvalJudgeRoute({ kind: "none", isConnectPermitted: true })).toBe("off");
    expect(instantEvalJudgeRoute({ kind: "cloud", isConnectPermitted: true })).toBe("own_key");
    expect(instantEvalJudgeRoute({ kind: "memory", isConnectPermitted: true })).toBe("own_key");
    expect(instantEvalJudgeRoute({ kind: "connect", isConnectPermitted: true })).toBe("connect");
    expect(instantEvalJudgeRoute({ kind: "connect", isConnectPermitted: false })).toBe(
      "disconnected",
    );
  });
});
