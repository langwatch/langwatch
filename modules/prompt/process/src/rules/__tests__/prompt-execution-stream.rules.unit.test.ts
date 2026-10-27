/**
 * @see specs/prompts/playground-conversation.feature
 * @see specs/model-providers/doubleword-provider.feature
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

  /** @scenario "A provider account with no credit left is named in the playground" */
  it("names an out-of-credit account for a bare 402", () => {
    const error = engineRunError("gateway returned non-2xx status 402", 402);
    expect(llmErrorOf(error).type).toBe("out_of_credit");
  });

  it("names rejected credentials for a bare 401", () => {
    expect(llmErrorOf(engineRunError("gateway returned non-2xx status 401", 401)).type).toBe(
      "auth",
    );
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
