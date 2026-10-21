import { describe, expect, it } from "vitest";

import { isEnterpriseGateError } from "../enterprise-gate.ts";

describe("isEnterpriseGateError", () => {
  it("is true for the plan refusal the directory reads throw", () => {
    expect(
      isEnterpriseGateError({
        data: { error: { code: "enterprise_plan_required", httpStatus: 402 } },
      }),
    ).toBe(true);
  });

  it("is false for any other failure, and for a value that is not an error", () => {
    expect(isEnterpriseGateError({ data: { error: { code: "forbidden", httpStatus: 403 } } })).toBe(
      false,
    );
    expect(isEnterpriseGateError(new Error("boom"))).toBe(false);
    expect(isEnterpriseGateError(null)).toBe(false);
  });
});
