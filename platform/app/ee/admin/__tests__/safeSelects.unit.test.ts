import { describe, expect, it } from "vitest";
import { ORGANIZATION_SAFE_SELECT } from "../safeSelects";

describe("ORGANIZATION_SAFE_SELECT", () => {
  describe("when an operator lists organizations in the backoffice", () => {
    /** @scenario The backoffice organizations list does not carry license keys */
    it("does not select the license key, which is credential material", () => {
      expect(Object.keys(ORGANIZATION_SAFE_SELECT)).not.toContain("license");
    });

    it("still selects when the license ends, which the list shows", () => {
      expect(ORGANIZATION_SAFE_SELECT.licenseExpiresAt).toBe(true);
    });

    it("selects no stored credential", () => {
      const selected = Object.keys(ORGANIZATION_SAFE_SELECT);

      for (const secret of [
        "s3AccessKeyId",
        "s3SecretAccessKey",
        "elasticsearchApiKey",
      ]) {
        expect(selected).not.toContain(secret);
      }
    });
  });
});
