import { describe, expect, it } from "vitest";
import { languageCheck } from "./languageCheck";
import type { Trace } from "../../server/tracer/types";
import type { Checks } from "../types";

describe("LanguageCheck Integration", () => {
  it("evaluates language check with a real request", async () => {
    const sampleTrace: Trace = {
      trace_id: "integration-test-language",
      project_id: "integration-test",
      metadata: {},
      input: { value: "hello how is it going my friend? testing" },
      output: { value: "ola como vai voce eu vou bem obrigado" },
      metrics: {},
      timestamps: { started_at: Date.now(), inserted_at: Date.now() },
    };

    const parameters: Checks["language_check"]["parameters"] = {
      checkFor: "input_matches_output",
      expectedLanguage: "any",
    };

    const result = await languageCheck(sampleTrace, [], parameters);

    expect(result.status).toBe("failed");
    expect(result.value).toBe(0);
  });

  it("evaluates language check with a specific expected language", async () => {
    const sampleTrace: Trace = {
      trace_id: "integration-test-language-specific",
      project_id: "integration-test",
      metadata: {},
      input: { value: "hello how is it going my friend? testing" },
      output: { value: "hello how is it going my friend? testing" },
      metrics: {},
      timestamps: { started_at: Date.now(), inserted_at: Date.now() },
    };

    const parameters: Checks["language_check"]["parameters"] = {
      checkFor: "input_matches_output",
      expectedLanguage: "EN",
    };

    const result = await languageCheck(sampleTrace, [], parameters);
    expect(result.status).toBe("succeeded");
    expect(result.value).toBe(1);
  });

  it("passes if it could not detect language", async () => {
    const sampleTrace: Trace = {
      trace_id: "integration-test-language-specific",
      project_id: "integration-test",
      metadata: {},
      input: { value: "small text" },
      output: { value: "small text" },
      metrics: {},
      timestamps: { started_at: Date.now(), inserted_at: Date.now() },
    };

    const parameters: Checks["language_check"]["parameters"] = {
      checkFor: "input_matches_output",
      expectedLanguage: "EN",
    };

    const result = await languageCheck(sampleTrace, [], parameters);
    expect(result.status).toBe("succeeded");
    expect(result.value).toBe(1);
  });

  it("should be okay if 'any' language is expected", async () => {
    const sampleTrace: Trace = {
      trace_id: "integration-test-language-specific",
      project_id: "integration-test",
      metadata: {},
      input: { value: "small text" },
      output: { value: "hello how is it going my friend? testing" },
      metrics: {},
      timestamps: { started_at: Date.now(), inserted_at: Date.now() },
    };

    const parameters: Checks["language_check"]["parameters"] = {
      checkFor: "input_matches_output",
      expectedLanguage: "any",
    };

    const result = await languageCheck(sampleTrace, [], parameters);
    expect(result.status).toBe("succeeded");
    expect(result.value).toBe(1);
  });
});
