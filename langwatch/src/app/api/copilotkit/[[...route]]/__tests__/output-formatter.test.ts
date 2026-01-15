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
  describe("when config and outputs are valid", () => {
    it("extracts string output with custom identifier", () => {
      const config: OutputConfig = { identifier: "result", type: "str" };
      const outputs = { result: "Hello World" };

      expect(extractStreamableOutput(outputs, config)).toBe("Hello World");
    });

    it("extracts string output with default identifier", () => {
      const config: OutputConfig = { identifier: "output", type: "str" };
      const outputs = { output: "Default works" };

      expect(extractStreamableOutput(outputs, config)).toBe("Default works");
    });

    it("extracts float output and converts to string", () => {
      const config: OutputConfig = { identifier: "score", type: "float" };
      const outputs = { score: 0.95 };

      expect(extractStreamableOutput(outputs, config)).toBe("0.95");
    });

    it("extracts boolean output and converts to string", () => {
      const config: OutputConfig = { identifier: "passed", type: "bool" };
      const outputs = { passed: true };

      expect(extractStreamableOutput(outputs, config)).toBe("true");
    });

    it("extracts json_schema output and formats as JSON", () => {
      const config: OutputConfig = { identifier: "analysis", type: "json_schema" };
      const outputs = { analysis: { sentiment: "positive" } };

      const result = extractStreamableOutput(outputs, config);
      expect(result).toContain('"sentiment"');
      expect(result).toContain('"positive"');
    });
  });

  describe("when outputs is undefined", () => {
    it("returns undefined", () => {
      const config: OutputConfig = { identifier: "result", type: "str" };

      expect(extractStreamableOutput(undefined, config)).toBeUndefined();
    });
  });

  describe("when config is undefined", () => {
    it("returns undefined", () => {
      const outputs = { result: "Hello" };

      expect(extractStreamableOutput(outputs, undefined)).toBeUndefined();
    });
  });

  describe("when identifier is missing from outputs", () => {
    it("returns undefined", () => {
      const config: OutputConfig = { identifier: "score", type: "str" };
      const outputs = { other_field: "some value" };

      expect(extractStreamableOutput(outputs, config)).toBeUndefined();
    });
  });

  describe("when value in outputs is null", () => {
    it("returns undefined", () => {
      const config: OutputConfig = { identifier: "result", type: "str" };
      const outputs = { result: null };

      expect(extractStreamableOutput(outputs, config)).toBeUndefined();
    });
  });

  describe("when multiple outputs exist", () => {
    it("only extracts the configured output", () => {
      const config: OutputConfig = { identifier: "summary", type: "str" };
      const outputs = { summary: "Good result", score: 0.85 };

      expect(extractStreamableOutput(outputs, config)).toBe("Good result");
    });
  });
});
