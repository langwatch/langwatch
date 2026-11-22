/**
 * The playground execute schema's message cap: the registry's enterprise
 * ceiling is the outer shell; the caller's own tier value is refused by the
 * application, not the schema.
 */
import { resolveRequestBound } from "@langwatch/plans";
import { describe, expect, it } from "vitest";

import { executeRequestSchema } from "../prompt.playground-execute.ts";

const ENTERPRISE_MESSAGES_MAX = resolveRequestBound("promptMessagesMax", "ENTERPRISE");

const formValues = {
  handle: null,
  scope: "PROJECT",
  version: {
    parameters: {},
    configData: {
      messages: [{ role: "user", content: "{{input}}" }],
      inputs: [{ identifier: "input", type: "str" }],
      outputs: [{ identifier: "output", type: "str" }],
      llm: { model: "openai/gpt-5-mini" },
    },
  },
};

const messages = (count: number) =>
  Array.from({ length: count }, (_, index) => ({ role: "user", content: `message ${index}` }));

const request = (messageCount: number) => ({
  projectId: "project-1",
  formValues,
  variables: [],
  messages: messages(messageCount),
});

describe("executeRequestSchema messages cap", () => {
  describe("given a message array at the registry's enterprise ceiling", () => {
    it("accepts the request", () => {
      const parsed = executeRequestSchema.safeParse(request(ENTERPRISE_MESSAGES_MAX));

      expect(parsed.success).toBe(true);
    });
  });

  describe("given a message array past the registry's enterprise ceiling", () => {
    it("rejects the request as malformed", () => {
      const parsed = executeRequestSchema.safeParse(request(ENTERPRISE_MESSAGES_MAX + 1));

      expect(parsed.success).toBe(false);
    });
  });

  describe("given a message array over the free tier but under the ceiling", () => {
    it("accepts the request: the tier refusal is the application's, not the schema's", () => {
      const freeMax = resolveRequestBound("promptMessagesMax", "FREE");
      const parsed = executeRequestSchema.safeParse(request(freeMax + 1));

      expect(parsed.success).toBe(true);
    });
  });
});
