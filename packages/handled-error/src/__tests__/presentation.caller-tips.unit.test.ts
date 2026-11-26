/**
 * A tip that names a meta field is for API callers and hidden from people, so every code that
 * has one must still give a person a next step: its registered description, or a tip for them.
 * Spec: specs/features/handled-error-presentation.feature
 */
import { describe, expect, it } from "vitest";

import { explainHandledError, isTipForPeople } from "../presentation.ts";
import type { HandledErrorShape } from "../read-handled-error.ts";
import { REMEDIATION_CODES, remediation } from "../remediation.ts";

const codesWithCallerTips = REMEDIATION_CODES.filter((code) =>
  (remediation(code).tips ?? []).some((tip) => !isTipForPeople(tip)),
);

function refusal(code: string): HandledErrorShape {
  return {
    code,
    meta: {},
    httpStatus: 400,
    fault: "customer",
    retryable: false,
    tips: [],
    docsUrl: undefined,
    traceId: undefined,
    reasons: [],
  };
}

describe("tips written for API callers", () => {
  it("are found in the registry", () => {
    expect(codesWithCallerTips).toContain("instant_eval_already_finished");
  });

  describe.each(codesWithCallerTips)("when %s reaches a person", (code) => {
    /** @scenario "Hiding a tip written for an API caller never leaves a person without a next step" */
    it("still gives them a next step", () => {
      const copy = explainHandledError(refusal(code));
      const tipsForPeople = (remediation(code).tips ?? []).filter(isTipForPeople);

      expect(
        (copy.isRegistered && copy.description.length > 0) || tipsForPeople.length > 0,
        `${code} hides its API-caller tips and has no registered description or tip for a person`,
      ).toBe(true);
    });
  });
});
