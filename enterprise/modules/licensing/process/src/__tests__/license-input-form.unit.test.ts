/** Spec: specs/licensing/configured-license-forms.feature */
import { detectLicenseInputForm } from "@langwatch/enterprise-licensing-contract";
import { describe, expect, it } from "vitest";

import { mintActivationCode } from "../rules/activation-code.rules.ts";

describe("detectLicenseInputForm", () => {
  describe("when the value is an activation code", () => {
    /** @scenario "an activation code and a signed license key are told apart by shape" */
    it("reads it as one in any spelling a customer pastes", () => {
      const code = mintActivationCode();
      const normalised = code.replace(/-/g, "");

      for (const pasted of [code, code.toLowerCase(), ` ${code.replace(/-/g, " ")} `]) {
        expect(detectLicenseInputForm(pasted)).toEqual({
          form: "activation_code",
          code: normalised,
        });
      }
    });
  });

  describe("when the value is a long base64 string", () => {
    /** @scenario "an activation code and a signed license key are told apart by shape" */
    it("reads it as a signed license key, trimmed", () => {
      const key = Buffer.from(
        JSON.stringify({ data: { licenseId: "lic-1" }, signature: "abc" }),
      ).toString("base64");

      expect(detectLicenseInputForm(`\n${key}\n`)).toEqual({
        form: "license_key",
        licenseKey: key,
      });
    });
  });

  describe("when the value is empty", () => {
    it("reads it as empty", () => {
      for (const value of [undefined, null, "", "   "]) {
        expect(detectLicenseInputForm(value)).toEqual({ form: "empty" });
      }
    });
  });
});
