import { describe, expect, it } from "vitest";
import { modelProviderCredentialCipherFromEnv } from "../model-provider-credential-cipher.composition";

describe("modelProviderCredentialCipherFromEnv", () => {
  describe("given a configured key", () => {
    it("round-trips a value through the deployment's cipher", () => {
      const cipher = modelProviderCredentialCipherFromEnv({ key: "aa".repeat(32) });

      expect(cipher.decrypt(cipher.encrypt("sk-secret"))).toBe("sk-secret");
    });
  });

  describe("when no key is configured", () => {
    it("refuses to build a cipher", () => {
      expect(() => modelProviderCredentialCipherFromEnv({ key: undefined })).toThrow(
        /CREDENTIALS_SECRET/,
      );
    });
  });
});
