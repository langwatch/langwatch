/**
 * pi's env block: the content switch the extension reads rides the same block
 * as its exporter names, so logout strips it with them.
 * Feature: specs/ai-governance/cli-wrappers/pi-env-injection.feature
 */

import { describe, expect, it } from "vitest";

import { buildOtelEnvBlock, telemetryEnvVarNames } from "../otel-env-block";

describe("pi's OTel env block", () => {
  describe("when the block is built for a pi run", () => {
    /** @scenario "Message content capture is switched on for the extension, as for copilot" */
    it("switches the GenAI content capture on, as copilot's block does", () => {
      const block = buildOtelEnvBlock("pi", "http://app/api/otel", "ik-lw-pi_secret");

      expect(block.OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT).toBe("true");
      expect(
        buildOtelEnvBlock("copilot", "", "").OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT,
      ).toBe("true");
    });

    /** @scenario "Message content capture is switched on for the extension, as for copilot" */
    it("lists the content switch among the names logout removes", () => {
      expect(telemetryEnvVarNames("pi")).toContain(
        "OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT",
      );
    });
  });
});
