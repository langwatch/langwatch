import { isInstantEvalField } from "@langwatch/trace-contract";
import { describe, expect, it } from "vitest";

import {
  sanitizeLlmOutput,
  summarizeProviderError,
  validateQuery,
} from "../trace-ai-query-output.rules.ts";
import { buildFieldsBlock } from "../trace-query-field-catalogue.rules.ts";

describe("sanitizeLlmOutput", () => {
  it("strips fences, labels and surrounding quotes", () => {
    expect(sanitizeLlmOutput('```lwql\nquery: "status:error"\n```')).toBe("status:error");
  });
});

describe("validateQuery", () => {
  it("refuses an empty query and accepts a parsing one", () => {
    expect(validateQuery("")).toEqual({ ok: false, error: "Empty query." });
    expect(validateQuery("status:error")).toEqual({ ok: true });
  });
});

describe("summarizeProviderError", () => {
  it("keeps status, vendor and model, and none of the provider's sentence", () => {
    const details = summarizeProviderError(
      new Error(
        "litellm.AuthenticationError: OpenAIException - Incorrect API key provided: sk-proj-x\n    at call (sdk.js:1:1)",
      ),
      { model: "openai/gpt-5" },
    );
    expect(details).toEqual({ provider: "openai", model: "openai/gpt-5" });
  });

  it("prefers the structured status code", () => {
    const failure = Object.assign(new Error("boom"), { statusCode: 429 });
    expect(summarizeProviderError(failure)).toEqual({ httpStatus: 429 });
  });
});

describe("buildFieldsBlock", () => {
  it("puts live facet values first and leaves out instant-eval fields", () => {
    const block = buildFieldsBlock({ dynamicValues: new Map([["status", ["live-status"]]]) });
    const lines = block.split("\n");
    expect(lines.find((line) => line.startsWith("- status "))).toContain("e.g. live-status");
    const names = lines.map((line) => line.slice(2).split(" ")[0] ?? "");
    expect(names.some((name) => isInstantEvalField(name))).toBe(false);
  });
});
