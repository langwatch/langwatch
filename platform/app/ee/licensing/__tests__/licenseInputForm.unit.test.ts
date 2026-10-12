import { describe, expect, it } from "vitest";
import { mintActivationCode } from "../activation/activationCode";
import { detectLicenseInputForm } from "../licenseInputForm";

describe("detectLicenseInputForm", () => {
  describe("when the value is an activation code", () => {
    /** @scenario "an activation code and a signed license key are told apart by shape" */
    it("reads it as one in any spelling a customer pastes", () => {
      const code = mintActivationCode();
      const normalised = code.replace(/-/g, "");

      for (const pasted of [
        code,
        code.toLowerCase(),
        ` ${code.replace(/-/g, " ")} `,
      ]) {
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
