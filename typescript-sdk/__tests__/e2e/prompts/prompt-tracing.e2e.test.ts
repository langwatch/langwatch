import { describe, expect, it, beforeAll, beforeEach } from "vitest";
import { getLangwatchSDK } from "../../helpers/get-sdk.js";
import { setupTestTraceProvider } from "../../helpers/setup-test-trace-provider.js";
import { type ReadableSpan } from "@opentelemetry/sdk-trace-node";
import { LangWatch, attributes } from "../../../dist/index.js";
import { promptResponseFactory } from "../../factories/prompt.factory.js";

const { spanExporter, findFinishedSpanByName } = setupTestTraceProvider();

describe("Prompt tracing", () => {
  let langwatch: LangWatch;

  beforeAll(async () => {
    const { LangWatch } = await getLangwatchSDK();
    langwatch = new LangWatch({
      apiKey: "test-key",
      endpoint: "https://app.langwatch.test",
    });
  });

  beforeEach(() => {
    spanExporter.reset();
    promptResponseFactory.rewindSequence();
  });

  describe("get tracing", () => {
    let getSpan: ReadableSpan | undefined;

    beforeEach(async () => {
      // Test template compilation
      await langwatch.prompts.get("prompt_123");
      getSpan = await findFinishedSpanByName("PromptsService.get");
    });

    it("should create a span with correct name", () => {
      expect(getSpan).toBeDefined();
    });

    it("should set span type to 'prompt'", () => {
      expect(getSpan?.attributes[attributes.ATTR_LANGWATCH_SPAN_TYPE]).toBe(
        "prompt"
      );
    });

    it("should set prompt metadata attributes", () => {
      expect(getSpan?.attributes[attributes.ATTR_LANGWATCH_PROMPT_ID]).toBe(
        "prompt_123"
      );
      expect(
        getSpan?.attributes[attributes.ATTR_LANGWATCH_PROMPT_VERSION_ID]
      ).toMatch(/^prompt_version_\d+$/);
      expect(
        getSpan?.attributes[attributes.ATTR_LANGWATCH_PROMPT_VERSION_NUMBER]
      ).toBeTypeOf("number");
    });

    it("should set output data", () => {
      expect(
        getSpan?.attributes[attributes.ATTR_LANGWATCH_OUTPUT]
      ).toBeDefined();

      const outputAttr = getSpan?.attributes[
        attributes.ATTR_LANGWATCH_OUTPUT
      ] as string;
      const output = JSON.parse(outputAttr);

      // Verify the prompt response structure is captured
      // The output is a string representation, so we need to check the type
      expect(output.type).toBe("json");
      expect(output.value).toBeDefined();
      expect(output.value.id).toBe("prompt_123");
      expect(output.value.name).toMatch(/^Test Prompt \d+$/);
      expect(output.value.handle).toMatch(/^test-prompt-\d+$/);
    });
  });

  describe("compilation", () => {
    let compileSpan: ReadableSpan | undefined;

    beforeEach(async () => {
      // Test template compilation
      const prompt = await langwatch.prompts.get("prompt_123");
      prompt!.compile({
        name: "Alice",
        topic: "weather",
      });
      compileSpan = await findFinishedSpanByName("Prompt.compile");
    });

    it("should create a span with correct name", () => {
      expect(compileSpan).toBeDefined();
    });

    it("should set span type to 'prompt'", () => {
      expect(compileSpan?.attributes[attributes.ATTR_LANGWATCH_SPAN_TYPE]).toBe(
        "prompt"
      );
    });

    it("should set prompt metadata attributes", () => {
      expect(compileSpan?.attributes[attributes.ATTR_LANGWATCH_PROMPT_ID]).toBe(
        "prompt_123"
      );
      expect(
        compileSpan?.attributes[attributes.ATTR_LANGWATCH_PROMPT_VERSION_ID]
      ).toMatch(/^prompt_version_\d+$/);
      expect(
        compileSpan?.attributes[attributes.ATTR_LANGWATCH_PROMPT_VERSION_NUMBER]
      ).toBeTypeOf("number");
    });

    it("should set output data", () => {
      // Check that output was set (it should be JSON stringified)
      expect(
        compileSpan?.attributes[attributes.ATTR_LANGWATCH_OUTPUT]
      ).toBeDefined();

      const outputAttr = compileSpan?.attributes[
        attributes.ATTR_LANGWATCH_OUTPUT
      ] as string;
      const output = JSON.parse(outputAttr);

      expect(output.value.prompt).toBe(
        "Hello Alice, how is the weather today?"
      );
      expect(output.value.messages[1].content).toBe("Tell me about weather");
    });

    it("should set input variables", () => {
      // Check that input variables were captured
      expect(
        compileSpan?.attributes[attributes.ATTR_LANGWATCH_PROMPT_VARIABLES]
      ).toBeDefined();

      const variablesAttr = compileSpan?.attributes[
        attributes.ATTR_LANGWATCH_PROMPT_VARIABLES
      ] as string;
      const variables = JSON.parse(variablesAttr);

      expect(variables.value).toEqual({
        name: "Alice",
        topic: "weather",
      });
    });
  });
});
