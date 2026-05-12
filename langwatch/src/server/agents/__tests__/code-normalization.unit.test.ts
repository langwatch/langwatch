import { describe, it, expect } from "vitest";
import type { CodeComponentConfig } from "~/optimization_studio/types/dsl";
import type { AgentComponentConfig } from "../agent.repository";
import {
  dedentPythonSource,
  normalizeAgentConfigForType,
} from "../code-normalization";

const makeCodeConfig = (code: string): CodeComponentConfig => ({
  name: "Code",
  description: "Python code block",
  parameters: [
    {
      identifier: "code",
      type: "code",
      value: code,
    },
  ],
  inputs: [{ identifier: "input", type: "str" }],
  outputs: [{ identifier: "output", type: "str" }],
});

describe("dedentPythonSource", () => {
  describe("when every non-blank line shares a leading-whitespace prefix", () => {
    it("strips the shared prefix (regression: #3013 Monaco paste)", () => {
      const indented = [
        "  class Code(dspy.Module):",
        "      def __call__(self, input):",
        "          return {\"output\": input.upper()}",
        "",
      ].join("\n");

      const result = dedentPythonSource(indented);

      expect(result).toBe(
        [
          "class Code(dspy.Module):",
          "    def __call__(self, input):",
          "        return {\"output\": input.upper()}",
          "",
        ].join("\n"),
      );
    });

    it("handles tab-only common indent", () => {
      const indented = "\tclass Code:\n\t    def __call__(self):\n\t        return None\n";
      const result = dedentPythonSource(indented);
      expect(result).toBe(
        "class Code:\n    def __call__(self):\n        return None\n",
      );
    });

    it("ignores blank lines when computing the common prefix", () => {
      const indented = [
        "    class Code:",
        "",
        "        def __call__(self):",
        "            return None",
      ].join("\n");

      const result = dedentPythonSource(indented);

      expect(result).toBe(
        ["class Code:", "", "    def __call__(self):", "        return None"].join(
          "\n",
        ),
      );
    });
  });

  describe("when the source has no shared leading indent", () => {
    it("leaves the source unchanged", () => {
      const source = "class Code:\n    def __call__(self):\n        return None\n";
      expect(dedentPythonSource(source)).toBe(source);
    });

    it("preserves intentional indent on a single function body", () => {
      const source = "def execute(x):\n    return x + 1\n";
      expect(dedentPythonSource(source)).toBe(source);
    });
  });

  describe("when the source contains mixed indentation", () => {
    it("only strips the common contiguous prefix", () => {
      const source = ["  a = 1", "    b = 2", "  c = 3"].join("\n");
      const result = dedentPythonSource(source);
      expect(result).toBe(["a = 1", "  b = 2", "c = 3"].join("\n"));
    });
  });

  describe("when the source has a leading blank line", () => {
    it("trims the leading blank line so the dedented source starts at column 0", () => {
      const source = "\n  class Code:\n      def __call__(self):\n          return None\n";
      const result = dedentPythonSource(source);
      expect(result).toBe(
        "class Code:\n    def __call__(self):\n        return None\n",
      );
    });
  });

  describe("when the source is empty or whitespace-only", () => {
    it("returns empty string for empty input", () => {
      expect(dedentPythonSource("")).toBe("");
    });

    it("collapses whitespace-only input to empty string", () => {
      expect(dedentPythonSource("   \n\t\n   ")).toBe("");
    });
  });
});

describe("normalizeAgentConfigForType", () => {
  describe("when the agent type is 'code'", () => {
    it("dedents the code parameter value", () => {
      const config = makeCodeConfig(
        "  class Code:\n      def __call__(self):\n          return None\n",
      );

      const result = normalizeAgentConfigForType("code", config);

      const codeParam = (result as CodeComponentConfig).parameters?.find(
        (p) => p.identifier === "code" && p.type === "code",
      );
      expect(codeParam?.value).toBe(
        "class Code:\n    def __call__(self):\n        return None\n",
      );
    });

    it("returns the same reference when no normalization is needed", () => {
      const config = makeCodeConfig(
        "class Code:\n    def __call__(self):\n        return None\n",
      );

      const result = normalizeAgentConfigForType("code", config);

      expect(result).toBe(config);
    });

    it("does not mutate the input config", () => {
      const original = "  class Code:\n      pass\n";
      const config = makeCodeConfig(original);

      normalizeAgentConfigForType("code", config);

      const codeParam = config.parameters?.find(
        (p) => p.identifier === "code" && p.type === "code",
      );
      expect(codeParam?.value).toBe(original);
    });

    it("leaves non-code parameters unchanged", () => {
      const config: CodeComponentConfig = {
        name: "Code",
        description: "Python code block",
        parameters: [
          { identifier: "code", type: "code", value: "  class X: pass\n" },
          { identifier: "other", type: "str", value: "  unchanged" },
        ],
        inputs: [{ identifier: "input", type: "str" }],
        outputs: [{ identifier: "output", type: "str" }],
      };

      const result = normalizeAgentConfigForType(
        "code",
        config,
      ) as CodeComponentConfig;

      const other = result.parameters?.find((p) => p.identifier === "other");
      expect(other?.value).toBe("  unchanged");
    });
  });

  describe("when the agent type is not 'code'", () => {
    it("returns the config unchanged for http agents", () => {
      const httpConfig = {
        name: "Http",
        description: "HTTP",
        url: "https://example.com",
        method: "POST",
        parameters: [],
      } as unknown as AgentComponentConfig;

      const result = normalizeAgentConfigForType("http", httpConfig);

      expect(result).toBe(httpConfig);
    });
  });
});
