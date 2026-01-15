import { describe, it, expect } from "vitest";
import {
  formatOutputForStreaming,
  extractStreamableOutput,
  type OutputConfig,
} from "../output-formatter";

describe("formatOutputForStreaming", () => {
  describe("when type is str", () => {
    it("returns string value as-is", () => {
      expect(formatOutputForStreaming("hello", "str")).toBe("hello");
    });

    it("converts non-string to string", () => {
      expect(formatOutputForStreaming(42, "str")).toBe("42");
    });

    it("returns undefined for null value", () => {
      expect(formatOutputForStreaming(null, "str")).toBeUndefined();
    });

    it("returns undefined for undefined value", () => {
      expect(formatOutputForStreaming(undefined, "str")).toBeUndefined();
    });
  });

  describe("when type is float", () => {
    it("converts number to string", () => {
      expect(formatOutputForStreaming(0.95, "float")).toBe("0.95");
    });

    it("handles integer numbers", () => {
      expect(formatOutputForStreaming(42, "float")).toBe("42");
    });

    it("returns undefined for string value (type mismatch)", () => {
      expect(formatOutputForStreaming("0.95", "float")).toBeUndefined();
    });

    it("returns undefined for null value", () => {
      expect(formatOutputForStreaming(null, "float")).toBeUndefined();
    });

    it("returns undefined for undefined value", () => {
      expect(formatOutputForStreaming(undefined, "float")).toBeUndefined();
    });
  });

  describe("when type is bool", () => {
    it("converts true to string", () => {
      expect(formatOutputForStreaming(true, "bool")).toBe("true");
    });

    it("converts false to string", () => {
      expect(formatOutputForStreaming(false, "bool")).toBe("false");
    });

    it("returns undefined for string value (type mismatch)", () => {
      expect(formatOutputForStreaming("true", "bool")).toBeUndefined();
    });

    it("returns undefined for null value", () => {
      expect(formatOutputForStreaming(null, "bool")).toBeUndefined();
    });

    it("returns undefined for undefined value", () => {
      expect(formatOutputForStreaming(undefined, "bool")).toBeUndefined();
    });
  });

  describe("when type is json_schema", () => {
    it("converts object to pretty-printed JSON", () => {
      const result = formatOutputForStreaming(
        { key: "value" },
        "json_schema"
      );
      expect(result).toBe('{\n  "key": "value"\n}');
    });

    it("handles nested objects", () => {
      const result = formatOutputForStreaming(
        { outer: { inner: "value" } },
        "json_schema"
      );
      expect(result).toContain('"outer"');
      expect(result).toContain('"inner"');
    });

    it("handles arrays", () => {
      const result = formatOutputForStreaming([1, 2, 3], "json_schema");
      expect(result).toBe("[\n  1,\n  2,\n  3\n]");
    });

    it("returns undefined for string value (type mismatch)", () => {
      expect(
        formatOutputForStreaming('{"key": "value"}', "json_schema")
      ).toBeUndefined();
    });

    it("returns undefined for null value", () => {
      expect(formatOutputForStreaming(null, "json_schema")).toBeUndefined();
    });

    it("returns undefined for undefined value", () => {
      expect(formatOutputForStreaming(undefined, "json_schema")).toBeUndefined();
    });
  });
});

describe("extractStreamableOutput", () => {
  // Single output with default "output" identifier - displays value as-is
  describe("single output with 'output' identifier (default)", () => {
    it("displays string value as-is", () => {
      const configs: OutputConfig[] = [{ identifier: "output", type: "str" }];
      const outputs = { output: "Hello World" };

      expect(extractStreamableOutput(outputs, configs)).toBe("Hello World");
    });

    it("displays float value as string", () => {
      const configs: OutputConfig[] = [{ identifier: "output", type: "float" }];
      const outputs = { output: 0.95 };

      expect(extractStreamableOutput(outputs, configs)).toBe("0.95");
    });

    it("displays boolean value as string", () => {
      const configs: OutputConfig[] = [{ identifier: "output", type: "bool" }];
      const outputs = { output: true };

      expect(extractStreamableOutput(outputs, configs)).toBe("true");
    });

    it("displays json_schema as formatted JSON", () => {
      const configs: OutputConfig[] = [{ identifier: "output", type: "json_schema" }];
      const outputs = { output: { sentiment: "positive" } };

      const result = extractStreamableOutput(outputs, configs);
      expect(result).toBe('{\n  "sentiment": "positive"\n}');
    });
  });

  // Single output with custom identifier - wrapped in JSON object
  describe("single output with custom identifier", () => {
    it("wraps string value in JSON object", () => {
      const configs: OutputConfig[] = [{ identifier: "result", type: "str" }];
      const outputs = { result: "Hello World" };

      const result = extractStreamableOutput(outputs, configs);
      expect(result).toBe('{\n  "result": "Hello World"\n}');
    });

    it("wraps float value in JSON object", () => {
      const configs: OutputConfig[] = [{ identifier: "score", type: "float" }];
      const outputs = { score: 0.95 };

      const result = extractStreamableOutput(outputs, configs);
      expect(result).toBe('{\n  "score": 0.95\n}');
    });

    it("wraps integer float value in JSON object", () => {
      const configs: OutputConfig[] = [{ identifier: "score", type: "float" }];
      const outputs = { score: 100 };

      const result = extractStreamableOutput(outputs, configs);
      expect(result).toBe('{\n  "score": 100\n}');
    });

    it("wraps boolean true value in JSON object", () => {
      const configs: OutputConfig[] = [{ identifier: "passed", type: "bool" }];
      const outputs = { passed: true };

      const result = extractStreamableOutput(outputs, configs);
      expect(result).toBe('{\n  "passed": true\n}');
    });

    it("wraps boolean false value in JSON object", () => {
      const configs: OutputConfig[] = [{ identifier: "valid", type: "bool" }];
      const outputs = { valid: false };

      const result = extractStreamableOutput(outputs, configs);
      expect(result).toBe('{\n  "valid": false\n}');
    });

    it("wraps json_schema value in JSON object with nested structure", () => {
      const configs: OutputConfig[] = [{ identifier: "analysis", type: "json_schema" }];
      const outputs = { analysis: { sentiment: "positive", confidence: 0.9 } };

      const result = extractStreamableOutput(outputs, configs);
      expect(result).toContain('"analysis"');
      expect(result).toContain('"sentiment"');
      expect(result).toContain('"positive"');
      expect(result).toContain('"confidence"');
      expect(result).toContain("0.9");
    });
  });

  // Multiple outputs - combined into single JSON object
  describe("multiple outputs", () => {
    it("combines multiple outputs into single JSON object", () => {
      const configs: OutputConfig[] = [
        { identifier: "complete_name", type: "str" },
        { identifier: "score", type: "float" },
      ];
      const outputs = { complete_name: "Sergio Cardenas", score: 10 };

      const result = extractStreamableOutput(outputs, configs);
      expect(result).toBe('{\n  "complete_name": "Sergio Cardenas",\n  "score": 10\n}');
    });

    it("combines string and boolean outputs", () => {
      const configs: OutputConfig[] = [
        { identifier: "summary", type: "str" },
        { identifier: "passed", type: "bool" },
      ];
      const outputs = { summary: "Good result", passed: true };

      const result = extractStreamableOutput(outputs, configs);
      expect(result).toBe('{\n  "summary": "Good result",\n  "passed": true\n}');
    });

    it("combines three outputs", () => {
      const configs: OutputConfig[] = [
        { identifier: "name", type: "str" },
        { identifier: "score", type: "float" },
        { identifier: "valid", type: "bool" },
      ];
      const outputs = { name: "Test", score: 95, valid: true };

      const result = extractStreamableOutput(outputs, configs);
      const parsed = JSON.parse(result!);
      expect(parsed).toEqual({ name: "Test", score: 95, valid: true });
    });

    it("only includes outputs that have valid values", () => {
      const configs: OutputConfig[] = [
        { identifier: "name", type: "str" },
        { identifier: "score", type: "float" },
      ];
      const outputs = { name: "Test", score: null }; // score is null

      const result = extractStreamableOutput(outputs, configs);
      expect(result).toBe('{\n  "name": "Test"\n}');
    });

    it("returns undefined when no outputs have valid values", () => {
      const configs: OutputConfig[] = [
        { identifier: "name", type: "str" },
        { identifier: "score", type: "float" },
      ];
      const outputs = { name: null, score: null };

      expect(extractStreamableOutput(outputs, configs)).toBeUndefined();
    });
  });

  // Edge cases
  describe("edge cases", () => {
    describe("when outputs is undefined", () => {
      it("returns undefined", () => {
        const configs: OutputConfig[] = [{ identifier: "result", type: "str" }];

        expect(extractStreamableOutput(undefined, configs)).toBeUndefined();
      });
    });

    describe("when configs is undefined", () => {
      it("returns undefined", () => {
        const outputs = { result: "Hello" };

        expect(extractStreamableOutput(outputs, undefined)).toBeUndefined();
      });
    });

    describe("when configs is empty array", () => {
      it("returns undefined", () => {
        const outputs = { result: "Hello" };

        expect(extractStreamableOutput(outputs, [])).toBeUndefined();
      });
    });

    describe("when identifier is missing from outputs", () => {
      it("returns undefined for single custom identifier", () => {
        const configs: OutputConfig[] = [{ identifier: "score", type: "str" }];
        const outputs = { other_field: "some value" };

        expect(extractStreamableOutput(outputs, configs)).toBeUndefined();
      });

      it("returns undefined for single default identifier", () => {
        const configs: OutputConfig[] = [{ identifier: "output", type: "str" }];
        const outputs = { other_field: "some value" };

        expect(extractStreamableOutput(outputs, configs)).toBeUndefined();
      });
    });

    describe("when value in outputs is null", () => {
      it("returns undefined for single custom identifier", () => {
        const configs: OutputConfig[] = [{ identifier: "result", type: "str" }];
        const outputs = { result: null };

        expect(extractStreamableOutput(outputs, configs)).toBeUndefined();
      });

      it("returns undefined for single default identifier", () => {
        const configs: OutputConfig[] = [{ identifier: "output", type: "str" }];
        const outputs = { output: null };

        expect(extractStreamableOutput(outputs, configs)).toBeUndefined();
      });
    });

    describe("when value in outputs is undefined", () => {
      it("returns undefined for single custom identifier", () => {
        const configs: OutputConfig[] = [{ identifier: "result", type: "str" }];
        const outputs = { result: undefined };

        expect(extractStreamableOutput(outputs, configs)).toBeUndefined();
      });
    });

    describe("when identifier has special characters", () => {
      it("wraps value with special char identifier in JSON object", () => {
        const configs: OutputConfig[] = [{ identifier: "my-score", type: "float" }];
        const outputs = { "my-score": 42 };

        const result = extractStreamableOutput(outputs, configs);
        expect(result).toBe('{\n  "my-score": 42\n}');
      });

      it("wraps value with underscore identifier in JSON object", () => {
        const configs: OutputConfig[] = [{ identifier: "my_result", type: "str" }];
        const outputs = { my_result: "test" };

        const result = extractStreamableOutput(outputs, configs);
        expect(result).toBe('{\n  "my_result": "test"\n}');
      });
    });

    describe("when single config but multiple outputs exist in data", () => {
      it("only extracts the configured custom identifier output", () => {
        const configs: OutputConfig[] = [{ identifier: "summary", type: "str" }];
        const outputs = { summary: "Good result", score: 0.85 };

        const result = extractStreamableOutput(outputs, configs);
        expect(result).toBe('{\n  "summary": "Good result"\n}');
      });

      it("only extracts the configured default identifier output", () => {
        const configs: OutputConfig[] = [{ identifier: "output", type: "str" }];
        const outputs = { output: "Good result", score: 0.85 };

        const result = extractStreamableOutput(outputs, configs);
        expect(result).toBe("Good result");
      });
    });
  });
});
