import { describe, expect, it } from "vitest";
import {
  DEMO_HTTP_AGENT_CONFIG,
  DEMO_PROMPT_CONFIG_DATA,
} from "../../../prisma/demo-platform-ids";
import { httpComponentSchema } from "../../../src/optimization_studio/types/dsl";
import { getLatestConfigVersionSchema } from "../../../src/server/prompt-config/repositories/llm-config-version-schema";

// The demo platform seeds these configs as raw JSON, and the app re-validates
// that JSON on every read (agent repository / prompt version repository), so
// an invalid seed would make the seeded records unloadable rather than merely
// ugly. These tests run the exact validators the read paths run.

describe("demo platform seed configs", () => {
  describe("when the seeded configs are checked against the validators the app applies at read time", () => {
    /** @scenario The demo preset's prompt and HTTP agent pass the app's own validators */
    it("parses both the HTTP agent config and the prompt configData cleanly", () => {
      const parsedAgent = httpComponentSchema.parse(DEMO_HTTP_AGENT_CONFIG);
      expect(parsedAgent.url).toBe(DEMO_HTTP_AGENT_CONFIG.url);

      const configDataSchema = getLatestConfigVersionSchema().shape.configData;
      const parsedPrompt = configDataSchema.parse(DEMO_PROMPT_CONFIG_DATA);
      expect(parsedPrompt.outputs.length).toBeGreaterThan(0);
    });

    it("targets the public echo service over https", () => {
      const url = new URL(DEMO_HTTP_AGENT_CONFIG.url);
      expect(url.protocol).toBe("https:");
      expect(url.hostname).toBe("httpbin.org");
    });
  });

  describe("when the prompt configData is inspected", () => {
    it("carries no temperature, which the seeded model family rejects", () => {
      expect(DEMO_PROMPT_CONFIG_DATA).not.toHaveProperty("temperature");
    });
  });
});
