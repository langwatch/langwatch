/**
 * The setup key read out of a setup link, and grouped for typing.
 * Spec: specs/identity/mfa-and-session-shape.feature
 */

import { describe, expect, it } from "vitest";

import { extractSetupKey, groupSetupKey } from "../setup-key.ts";

describe("extractSetupKey", () => {
  it("reads the secret out of a setup link", () => {
    expect(
      extractSetupKey(
        "otpauth://totp/LangWatch:sam@acme.com?secret=JBSWY3DPEHPK3PXP&issuer=LangWatch",
      ),
    ).toBe("JBSWY3DPEHPK3PXP");
  });

  it("answers nothing for a link without one", () => {
    expect(
      extractSetupKey("otpauth://totp/LangWatch:sam@acme.com?issuer=LangWatch"),
    ).toBeUndefined();
  });

  it("answers nothing for something that is not a link", () => {
    expect(extractSetupKey("not a link")).toBeUndefined();
  });
});

describe("groupSetupKey", () => {
  it("groups the key four characters at a time", () => {
    expect(groupSetupKey("JBSWY3DPEHPK3PXP")).toBe("JBSW Y3DP EHPK 3PXP");
  });
});
