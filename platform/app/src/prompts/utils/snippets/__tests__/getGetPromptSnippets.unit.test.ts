/**
 * Spec: specs/prompts/prompt-api-snippet-dialog.feature
 */
import { describe, expect, it } from "vitest";
import { getGetPromptSnippets } from "../getGetPromptSnippets";

const python = (snippets: ReturnType<typeof getGetPromptSnippets>) =>
  snippets.find((s) => s.target === "python_python3")!.content;
const typescript = (snippets: ReturnType<typeof getGetPromptSnippets>) =>
  snippets.find((s) => s.target === "node_native")!.content;
const go = (snippets: ReturnType<typeof getGetPromptSnippets>) =>
  snippets.find((s) => s.target === "go_native")!.content;
const curl = (snippets: ReturnType<typeof getGetPromptSnippets>) =>
  snippets.find((s) => s.target === "shell_curl")!.content;

describe("getGetPromptSnippets()", () => {
  describe("when no label is provided", () => {
    /** @scenario "The snippet calls the prompt the reader has open" */
    it("uses bare handle in SDK snippets", () => {
      const snippets = getGetPromptSnippets({ promptHandle: "support-triage" });

      expect(python(snippets)).toContain('prompts.get("support-triage")');
      expect(typescript(snippets)).toContain("prompts.get('support-triage')");
      expect(python(snippets)).not.toContain("support-triage:");
      expect(python(snippets)).not.toContain("tagged");
    });

    /** @scenario "The snippet calls the prompt the reader has open" */
    it("uses bare handle in the Go and curl snippets", () => {
      const snippets = getGetPromptSnippets({ promptHandle: "support-triage" });

      expect(go(snippets)).toContain(
        'Prompts.Get(context.Background(), "support-triage", nil)',
      );
      expect(curl(snippets)).toContain("/api/prompts/support-triage");
      expect(curl(snippets)).not.toContain("?label=");
    });
  });

  describe("when label is provided", () => {
    /** @scenario "A tagged snippet asks for that tag" */
    it("uses shorthand syntax in SDK snippets", () => {
      const snippets = getGetPromptSnippets({
        promptHandle: "support-triage",
        label: "production",
      });

      expect(python(snippets)).toContain(
        'prompts.get("support-triage:production")',
      );
      expect(typescript(snippets)).toContain(
        "prompts.get('support-triage:production')",
      );
    });

    /** @scenario "A tagged snippet asks for that tag" */
    it("uses shorthand syntax in every snippet", () => {
      const snippets = getGetPromptSnippets({
        promptHandle: "support-triage",
        label: "staging",
      });

      for (const snippet of snippets) {
        expect(snippet.content).toContain("support-triage:staging");
        expect(snippet.content).not.toContain("?label=");
      }
    });

    /** @scenario "A tagged snippet asks for that tag" */
    it("names the tag in the SDK snippet comment", () => {
      const snippets = getGetPromptSnippets({
        promptHandle: "support-triage",
        label: "production",
      });

      expect(python(snippets)).toContain('tagged "production"');
    });
  });

  describe("when the prompt declares variables", () => {
    /** @scenario "The compile call passes the variables the prompt declares" */
    it("passes those identifiers to compile", () => {
      const snippets = getGetPromptSnippets({
        promptHandle: "support-triage",
        variables: [
          { identifier: "customer_name", type: "str" },
          { identifier: "order_id", type: "str" },
        ],
      });

      expect(python(snippets)).toContain(
        'compiled = prompt.compile(\n    customer_name="Jane Doe",\n    order_id="abc123",\n)',
      );
      expect(typescript(snippets)).toContain(
        "const compiled = prompt.compile({\n  customer_name: 'Jane Doe',\n  order_id: 'abc123',\n});",
      );
    });

    /** @scenario "The compile call passes the variables the prompt declares" */
    it("invents no variable of its own", () => {
      const snippets = getGetPromptSnippets({
        promptHandle: "support-triage",
        variables: [{ identifier: "customer_name", type: "str" }],
      });

      for (const content of [python(snippets), typescript(snippets)]) {
        expect(content).not.toContain("user_name");
        expect(content).not.toContain("input=");
        expect(content).not.toContain("Hello world");
      }
    });

    /** @scenario "A variable's example value matches the type it was declared with" */
    it("gives each example value the declared type", () => {
      const snippets = getGetPromptSnippets({
        promptHandle: "support-triage",
        variables: [
          { identifier: "is_urgent", type: "bool" },
          { identifier: "score", type: "float" },
          { identifier: "tags", type: "list[str]" },
        ],
      });

      expect(python(snippets)).toContain("is_urgent=True,");
      expect(python(snippets)).toContain("score=0.5,");
      expect(python(snippets)).toContain('tags=["example"],');
      expect(typescript(snippets)).toContain("is_urgent: true,");
      expect(typescript(snippets)).toContain("score: 0.5,");
      expect(typescript(snippets)).toContain("tags: ['example'],");
    });

    /** @scenario "A variable's example value reads like real data" */
    it("derives a readable example from the variable's name", () => {
      const snippets = getGetPromptSnippets({
        promptHandle: "support-triage",
        variables: [
          { identifier: "customer_email", type: "str" },
          { identifier: "question", type: "str" },
        ],
      });

      expect(python(snippets)).toContain('customer_email="jane@example.com"');
      expect(python(snippets)).toContain(
        'question="How do I reset my password?"',
      );
    });
  });

  describe("when the prompt declares no variables", () => {
    /** @scenario "A prompt with no variables compiles with no arguments" */
    it("compiles with an empty argument list", () => {
      const snippets = getGetPromptSnippets({ promptHandle: "support-triage" });

      expect(python(snippets)).toContain("compiled = prompt.compile()");
      expect(typescript(snippets)).toContain(
        "const compiled = prompt.compile();",
      );
    });
  });

  describe("when reading the whole SDK snippet", () => {
    /** @scenario "The snippet gets the prompt and compiles it, and nothing else" */
    it("shows the get and the compile only", () => {
      const snippets = getGetPromptSnippets({
        promptHandle: "support-triage",
        variables: [{ identifier: "customer_name", type: "str" }],
      });

      for (const content of [python(snippets), typescript(snippets)]) {
        expect(content).not.toContain("prompt.name");
        expect(content).not.toContain("prompt.model");
        expect(content).not.toContain("version_number");
        expect(content).not.toContain("prompt.version");
      }
    });

    /** @scenario "No snippet carries a project id" */
    it("passes no project id, because the API key resolves the project", () => {
      const snippets = getGetPromptSnippets({
        promptHandle: "support-triage",
        variables: [{ identifier: "customer_name", type: "str" }],
      });

      for (const snippet of snippets) {
        expect(snippet.content).not.toMatch(/project[_-]?id/i);
      }
    });
  });

  describe("when listing the languages on offer", () => {
    /** @scenario "The dialog offers Python, TypeScript, Go and curl" */
    it("returns Python, TypeScript, Go and curl, in that order", () => {
      const snippets = getGetPromptSnippets();

      expect(snippets.map((s) => s.target)).toEqual([
        "python_python3",
        "node_native",
        "go_native",
        "shell_curl",
      ]);
    });
  });

  describe("when called with no params", () => {
    /** @scenario "The snippet calls the prompt the reader has open" */
    it("uses default handle and api key", () => {
      const snippets = getGetPromptSnippets();

      expect(python(snippets)).toContain('prompts.get("{handle}")');
      expect(python(snippets)).toContain("YOUR_API_KEY");
    });
  });
});
