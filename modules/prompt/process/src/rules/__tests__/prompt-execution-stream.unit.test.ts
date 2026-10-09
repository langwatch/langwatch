/**
 * The playground names a provider failure from the HTTP status the engine
 * reports, since "gateway returned non-2xx status N" says nothing by itself.
 * @see specs/model-providers/doubleword-provider.feature
 */
import type { StudioServerEvent } from "@langwatch/workflow-contract";
import { describe, expect, it, vi } from "vitest";

import { PROMPT_NODE_ID } from "../prompt-execution-event.rules.ts";
import {
  handleEngineEvent,
  parseNodeError,
  upstreamLLMError,
} from "../prompt-execution-stream.rules.ts";

const failedNode = (upstreamStatus: number | undefined): StudioServerEvent =>
  ({
    type: "component_state_change",
    payload: {
      component_id: PROMPT_NODE_ID,
      execution_state: {
        status: "error",
        error: `gateway returned non-2xx status ${upstreamStatus ?? 500}`,
        error_type: "llm_error",
        upstream_status: upstreamStatus,
      },
    },
  }) as StudioServerEvent;

function thrownBy(serverEvent: StudioServerEvent): unknown {
  try {
    handleEngineEvent({ serverEvent, outputConfigs: undefined, sentSoFar: "", send: vi.fn() });
  } catch (error) {
    return error;
  }
  throw new Error("the failed node did not throw");
}

describe("handleEngineEvent", () => {
  describe("when the model provider refuses the call with an HTTP status", () => {
    it("throws a failure that carries the status", () => {
      const error = thrownBy(failedNode(402));

      expect(error).toMatchObject({ name: "UpstreamLLMError", upstreamStatus: 402 });
    });

    /** @scenario A provider account with no credit left is named in the playground */
    it("names an out-of-credit account for a 402", () => {
      expect(parseNodeError(thrownBy(failedNode(402))).type).toBe("out_of_credit");
    });

    it("names rejected credentials for a 401", () => {
      expect(parseNodeError(thrownBy(failedNode(401))).type).toBe("auth");
    });

    it("names a rate limit for a 429", () => {
      expect(parseNodeError(thrownBy(failedNode(429))).type).toBe("rate_limit");
    });
  });

  describe("when the failure carries no status", () => {
    it("stays unknown and keeps the message", () => {
      const parsed = parseNodeError(thrownBy(failedNode(undefined)));

      expect(parsed).toEqual({ type: "unknown", message: "gateway returned non-2xx status 500" });
    });
  });
});

describe("parseNodeError", () => {
  describe("when the message already names the failure", () => {
    it("keeps the type the message gave over the status", () => {
      const error = upstreamLLMError({
        message: "litellm.RateLimitError: GroqException - slow down",
        upstreamStatus: 402,
      });

      expect(parseNodeError(error).type).toBe("rate_limit");
    });
  });
});
