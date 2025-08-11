import { describe, expect, it, beforeAll, beforeEach } from "vitest";
import { getLangwatchSDK } from "../../helpers/get-sdk.js";
import { setupTestTraceProvider } from "../../helpers/setup-test-trace-provider.js";
import { type ReadableSpan } from "@opentelemetry/sdk-trace-node";
import { LangWatch, attributes } from "langwatch";

const { spanExporter, findFinishedSpanByName } = setupTestTraceProvider();

describe("Prompt tracing", () => {
  let langwatch: LangWatch;

  beforeAll(async () => {
    const { LangWatch } = await getLangwatchSDK();
    langwatch = new LangWatch({
      apiKey: "test-key",
      endpoint: "http://localhost:3000",
    });
  });

  beforeEach(() => {
    spanExporter.reset();
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
      ).toBe("prompt_version_1");
      expect(
        getSpan?.attributes[attributes.ATTR_LANGWATCH_PROMPT_VERSION_NUMBER]
      ).toBe(1);
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
      expect(output.type).toBe("json");
      expect(output.value).toBeDefined();
      expect(output.value.id).toBe("prompt_123");
      expect(output.value.name).toBe("Test Prompt 1");
      expect(output.value.handle).toBe("test-prompt-1");
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
      ).toBe("prompt_version_1");
      expect(
        compileSpan?.attributes[attributes.ATTR_LANGWATCH_PROMPT_VERSION_NUMBER]
      ).toBe(1);
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
