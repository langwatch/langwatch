/**
 * The shape of the `execute_component` event the playground sends.
 *
 * The event used to be cast to `StudioClientEvent`, which let a payload field
 * that no schema declares ride along unnoticed. Parsing the real event against
 * the real schema is what keeps the two honest.
 */
import { describe, expect, it } from "vitest";
import { studioClientEventSchema } from "~/optimization_studio/types/events";
import type { PromptConfigFormValues } from "~/prompts/types";
import { buildPromptExecutionEvent } from "../buildPromptExecutionEvent";

const formValues = {
  version: {
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
} as unknown as PromptConfigFormValues;

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
