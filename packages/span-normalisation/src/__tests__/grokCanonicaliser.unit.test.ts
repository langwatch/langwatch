/**
 * Grok's log records, keys and values as a grok 1.0.70 session sent them.
 * @see specs/coding-agent/grok-sessions.feature
 */

import { describe, expect, it } from "vitest";

import { GrokCanonicaliserService } from "../grokCanonicaliser.ts";
import { createLogExtractorContext } from "./testHelpers.ts";

const GROK_SCOPE = "ai.xai.grok_code";

describe("GrokCanonicaliserService.applyLog", () => {
  /** @scenario "A Grok trace names the model its log records carry" */
  it("lifts the model a Grok turn record carries", () => {
    const ctx = createLogExtractorContext(GROK_SCOPE, {
      "event.name": "grok_code.api_request",
      "session.id": "01a1ab72-d143-72d3-a4ac-d9fd9d651318",
      model: "grok-4.7",
      input_tokens: "120",
      cost_usd_micros: "915",
    });

    GrokCanonicaliserService.create().applyLog(ctx);

    expect(ctx.out).toEqual({ "langwatch.model": "grok-4.7" });
    expect(ctx.recordRule).toHaveBeenCalledWith("grok:log.model");
  });

  it("leaves a record without a model alone", () => {
    const ctx = createLogExtractorContext(GROK_SCOPE, {
      "event.name": "grok_code.assistant_response",
      response: "hi",
    });

    GrokCanonicaliserService.create().applyLog(ctx);

    expect(ctx.out).toEqual({});
  });

  it("ignores a `model` attribute under any other scope", () => {
    const ctx = createLogExtractorContext("com.anthropic.claude_code.events", {
      "event.name": "api_request",
      model: "claude-opus-4-8",
    });

    GrokCanonicaliserService.create().applyLog(ctx);

    expect(ctx.out).toEqual({});
  });
});
