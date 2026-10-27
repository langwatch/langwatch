import type { PromptConfigFormValues } from "@langwatch/prompt-contract";
import { studioClientEventSchema } from "@langwatch/workflow-contract";
/**
 * The shape of the `execute_component` event the playground sends. Used to
 * be cast to `StudioClientEvent`, letting an undeclared field ride along
 * unnoticed; parsing the real event against the schema keeps the two honest.
 */
import { describe, expect, it } from "vitest";

import { buildPromptExecutionEvent } from "../prompt-execution-event.rules.ts";

const formValues: PromptConfigFormValues = {
  handle: null,
  scope: "PROJECT",
  version: {
    parameters: {},
    configData: {
      llm: { model: "openai/gpt-5-mini" },
      messages: [
        { role: "system", content: "You are a terse assistant." },
        { role: "user", content: "{{input}}" },
      ],
      inputs: [{ identifier: "input", type: "str" }],
      outputs: [{ identifier: "output", type: "str" }],
    },
  },
};

const buildEvent = () =>
  buildPromptExecutionEvent({
    formValues,
    messages: [{ role: "user", content: "Where is Leiden?" }],
    variables: [],
    traceId: "trace-1",
    threadId: "thread-1",
  });

describe("buildPromptExecutionEvent", () => {
  describe("when the playground runs a prompt", () => {
    it("emits an event the studio event schema accepts", () => {
      expect(() => studioClientEventSchema.parse(buildEvent())).not.toThrow();
    });

    it("carries tracing on the workflow rather than the payload", () => {
      const event = buildEvent();

      if (event.type !== "execute_component") {
        throw new Error(`unexpected event type: ${event.type}`);
      }

      expect(event.payload).not.toHaveProperty("enable_tracing");
      expect(event.payload.workflow.enable_tracing).toBe(true);
    });
  });
});
