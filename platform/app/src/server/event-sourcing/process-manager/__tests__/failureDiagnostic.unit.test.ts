import { describe, expect, it } from "vitest";

import { toSafeFailureDiagnostic } from "../failureDiagnostic";

describe("toSafeFailureDiagnostic", () => {
  it.each([
    "Authorization: Bearer sk-live-secret-token",
    "prompt-derived customer text: tell me my medical history",
    "password=hunter2 upstream request failed",
  ])("omits untrusted error content: %s", (sensitiveMessage) => {
    const error = new Error(sensitiveMessage);
    error.name = `CustomError-${sensitiveMessage}`;

    const diagnostic = toSafeFailureDiagnostic(error);
    const serialized = JSON.stringify(diagnostic);

    expect(diagnostic).toEqual({
      errorType: "Error",
      errorMessage: "Operation failed; sensitive details were omitted",
    });
    expect(serialized).not.toContain(sensitiveMessage);
    expect(serialized).not.toContain("sk-live-secret-token");
    expect(serialized).not.toContain("medical history");
    expect(serialized).not.toContain("hunter2");
  });

  it("retains only a trusted built-in failure category", () => {
    expect(toSafeFailureDiagnostic(new TypeError("customer content"))).toEqual({
      errorType: "TypeError",
      errorMessage: "Operation failed; sensitive details were omitted",
    });
    expect(toSafeFailureDiagnostic({ secret: "sk-live" })).toEqual({
      errorType: "NonErrorThrown",
      errorMessage: "Operation failed; sensitive details were omitted",
    });
  });
});
