import { RuntimeConfig } from "@langwatch/config";
import { describe, expect, it } from "vitest";
import { dataPrivacyServerConfigDefinition } from "../data-privacy.config.ts";

const read = (source: Record<string, unknown>) =>
  RuntimeConfig.create({
    name: "data-privacy",
    definition: dataPrivacyServerConfigDefinition,
    source,
  }).value;

describe("data privacy server configuration", () => {
  describe("given the DLP opt-out is written the way the deployment reads it", () => {
    /** @scenario "One variable has one owner across every process" */
    it("carries it as written, so both processes reach one answer", () => {
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
