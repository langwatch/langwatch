import { describe, expect, it } from "vitest";
import { getGetPromptSnippets } from "../getGetPromptSnippets";

describe("getGetPromptSnippets()", () => {
  describe("when no label is provided", () => {
    it("uses bare handle in SDK snippets", () => {
      const snippets = getGetPromptSnippets({ promptHandle: "my-prompt" });
      const python = snippets.find((s) => s.target === "python_python3")!;
      const ts = snippets.find((s) => s.target === "node_native")!;

      expect(python.content).toContain('prompts.get("my-prompt")');
      expect(ts.content).toContain("prompts.get('my-prompt')");
      expect(python.content).not.toContain("my-prompt:");
      expect(python.content).not.toContain("tagged");
    });

    it("uses bare handle in HTTP snippets", () => {
      const snippets = getGetPromptSnippets({ promptHandle: "my-prompt" });
      const curl = snippets.find((s) => s.target === "shell_curl")!;

      expect(curl.content).toContain("/api/prompts/my-prompt");
      expect(curl.content).not.toContain("?label=");
    });
  });

  describe("when label is provided", () => {
    it("uses shorthand syntax in SDK snippets", () => {
      const snippets = getGetPromptSnippets({
        promptHandle: "my-prompt",
        label: "production",
      });
      const python = snippets.find((s) => s.target === "python_python3")!;
      const ts = snippets.find((s) => s.target === "node_native")!;

      expect(python.content).toContain('prompts.get("my-prompt:production")');
      expect(ts.content).toContain("prompts.get('my-prompt:production')");
    });

    it("uses shorthand syntax in all HTTP snippets", () => {
      const snippets = getGetPromptSnippets({
        promptHandle: "my-prompt",
        label: "staging",
      });

      for (const target of [
        "shell_curl",
        "php_curl",
        "go_native",
        "java_unirest",
      ] as const) {
        const snippet = snippets.find((s) => s.target === target)!;
        expect(snippet.content).toContain("/api/prompts/my-prompt:staging");
        expect(snippet.content).not.toContain("?label=");
      }
    });

    it("includes tagged comment in SDK snippets", () => {
      const snippets = getGetPromptSnippets({
        promptHandle: "my-prompt",
        label: "production",
      });
      const python = snippets.find((s) => s.target === "python_python3")!;

      expect(python.content).toContain('(tagged "production")');
    });
  });

  describe("when called with no params", () => {
    it("uses default handle and api key", () => {
      const snippets = getGetPromptSnippets();
      const python = snippets.find((s) => s.target === "python_python3")!;

      expect(python.content).toContain('prompts.get("{handle}")');
      expect(python.content).toContain("YOUR_API_KEY");
    });

    it("returns all 6 language targets", () => {
      const snippets = getGetPromptSnippets();
      expect(snippets).toHaveLength(6);
    });
  });
});
