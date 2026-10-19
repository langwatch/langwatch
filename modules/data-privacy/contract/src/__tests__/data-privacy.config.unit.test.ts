import { parseProcessConfig } from "@langwatch/config";
import { describe, expect, it } from "vitest";

import { dataPrivacyConfig, isGoogleDlpDisabled } from "../data-privacy.config.ts";

const read = (source: Record<string, string | undefined>) =>
  parseProcessConfig({
    owners: [{ name: "data-privacy", config: dataPrivacyConfig }],
    environment: source,
  })["data-privacy"];

describe("data privacy server configuration", () => {
  describe("given the DLP opt-out is written the way the deployment reads it", () => {
    /** @scenario "One variable has one owner across every process" */
    it("carries it as written, so both processes reach one answer", () => {
      expect(read({ LANGWATCH_DISABLE_GOOGLE_DLP: "true" }).googleDlpDisabled).toBe("true");
      expect(read({}).googleDlpDisabled).toBeUndefined();
    });
  });

  describe("given the DLP opt-out written true in any case", () => {
    /** @scenario "A setting written the way the previous release read it keeps that meaning" */
    it("turns Google DLP off as the previous release did", () => {
      for (const value of ["true", "TRUE", "True"]) {
        expect(isGoogleDlpDisabled({ config: read({ LANGWATCH_DISABLE_GOOGLE_DLP: value }) })).toBe(
          true,
        );
      }
    });

    it("leaves Google DLP on for any other value or none", () => {
      for (const value of [undefined, "", "1", "false"]) {
        expect(isGoogleDlpDisabled({ config: read({ LANGWATCH_DISABLE_GOOGLE_DLP: value }) })).toBe(
          false,
        );
      }
    });
  });

  describe("given no privacy variable is set", () => {
    /** @scenario "The four privacy variables are read the way the application reads them" */
    it("leaves redaction on and carries each variable as the deployment wrote it", () => {
      expect(read({}).enforcement).toBeUndefined();
      expect(read({ LANGWATCH_DATA_PRIVACY_ENFORCEMENT: "off" }).enforcement).toBe("off");
      expect(read({ LANGWATCH_DISABLE_GOOGLE_DLP: "true" }).googleDlpDisabled).toBe("true");
      expect(read({}).googleDlpDisabled).toBeUndefined();
    });
  });

  describe("given native enforcement is turned off", () => {
    /** @scenario "A feature reads its configuration through its own schema" */
    it("carries the deployment's own word for it", () => {
      expect(read({ LANGWATCH_DATA_PRIVACY_ENFORCEMENT: "off" }).enforcement).toBe("off");
    });
  });
});
