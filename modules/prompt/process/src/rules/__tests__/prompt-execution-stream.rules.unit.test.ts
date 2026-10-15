/**
 * @see specs/prompts/playground-conversation.feature
 */
import { describe, expect, it } from "vitest";

import { engineRunError, handleEngineEvent, llmErrorOf } from "../prompt-execution-stream.rules.ts";

describe("llmErrorOf", () => {
  /** @scenario "A provider failure shows our rate-limit copy when the engine reports a bare 429" */
  it("classifies a bare provider message by the status the engine kept", () => {
    expect(llmErrorOf(engineRunError("openai: rate limited", 429))).toEqual({
      type: "rate_limit",
      message: "openai: rate limited",
    });
  });

  it("leaves a message with no status unknown", () => {
    expect(llmErrorOf(engineRunError("boom")).type).toBe("unknown");
  });

  it("keeps the litellm classification over the status", () => {
    const raw = "litellm.AuthenticationError: OpenAIException - bad key";
    expect(llmErrorOf(engineRunError(raw, 429)).type).toBe("auth");
  });
});

describe("handleEngineEvent", () => {
  it("carries the upstream status on a failed prompt node", () => {
    const run = () =>
      handleEngineEvent({
        serverEvent: {
          type: "component_state_change",
          payload: {
            component_id: "prompt_node",
            execution_state: { status: "error", error: "rate limited", upstream_status: 429 },
          },
        } as never,
        outputConfigs: undefined,
        sentSoFar: "",
        send: () => undefined,
      });
    expect(run).toThrow(expect.objectContaining({ upstreamStatus: 429 }));
  });
});
