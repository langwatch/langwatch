import { describe, expect, it } from "vitest";
import { mergeAutoDetectedInputs } from "../mergeAutoDetectedInputs";

describe("mergeAutoDetectedInputs()", () => {
  describe("given a prompt with simple mustache variables", () => {
    describe("when extracting variables", () => {
      it("detects variables from prompt text", () => {
        const result = mergeAutoDetectedInputs({
          prompt: 'hello {{name}}, how is your {{pet_name}} today?',
          messages: [],
          inputs: [],
        });

        expect(result).toContainEqual({ identifier: "name", type: "str" });
        expect(result).toContainEqual({ identifier: "pet_name", type: "str" });
      });
    });
  });

  describe("given a prompt with variables in multiple messages", () => {
    describe("when extracting variables from all messages", () => {
      it("detects variables from both prompt and messages", () => {
        const result = mergeAutoDetectedInputs({
          prompt: "You are a {{role}} assistant",
          messages: [{ role: "user", content: "Help me with {{task}}" }],
          inputs: [],
        });

        expect(result).toContainEqual({ identifier: "role", type: "str" });
        expect(result).toContainEqual({ identifier: "task", type: "str" });
      });
    });
  });

  describe("given a prompt with loop iterator variables", () => {
    describe("when extracting variables", () => {
      it("detects collection variable but not loop iterator", () => {
        const result = mergeAutoDetectedInputs({
          prompt:
            "{% for col in column_headers %}{{ col.column_name }}{% endfor %}",
          messages: [],
          inputs: [],
        });

        expect(result).toContainEqual({
          identifier: "column_headers",
          type: "str",
        });
        const identifiers = result.map((i) => i.identifier);
        expect(identifiers).not.toContain("col");
      });
    });
  });

  describe("given a prompt with assigned variables", () => {
    describe("when extracting variables", () => {
      it("detects input variable but not assigned variable", () => {
        const result = mergeAutoDetectedInputs({
          prompt:
            "{% assign greeting = 'Hello' %}{{ greeting }} {{ name }}",
          messages: [],
          inputs: [],
        });

        expect(result).toContainEqual({ identifier: "name", type: "str" });
        const identifiers = result.map((i) => i.identifier);
        expect(identifiers).not.toContain("greeting");
      });
    });
  });

  describe("given a prompt with dot notation variables", () => {
    describe("when extracting variables", () => {
      it("extracts root variable only", () => {
        const result = mergeAutoDetectedInputs({
          prompt: "{{ user.name }} lives in {{ user.city }}",
          messages: [],
          inputs: [],
        });

        expect(result).toContainEqual({ identifier: "user", type: "str" });
        const identifiers = result.map((i) => i.identifier);
        expect(identifiers).not.toContain("user.name");
        expect(identifiers).not.toContain("user.city");
      });
    });
  });

  describe("given explicitly provided inputs alongside template variables", () => {
    describe("when merging auto-detected with explicit inputs", () => {
      it("preserves explicit input and adds auto-detected variable", () => {
        const result = mergeAutoDetectedInputs({
          prompt: "hello {{name}}, your pet {{pet_name}} says hi",
          messages: [],
          inputs: [{ identifier: "name", type: "str" }],
        });

        expect(result).toContainEqual({ identifier: "name", type: "str" });
        expect(result).toContainEqual({
          identifier: "pet_name",
          type: "str",
        });
      });
    });
  });

  describe("given explicit input with non-default type", () => {
    describe("when merging", () => {
      it("preserves the explicit type instead of overwriting with str", () => {
        const result = mergeAutoDetectedInputs({
          prompt: "data: {{config}}",
          messages: [],
          inputs: [{ identifier: "config", type: "dict" }],
        });

        expect(result).toContainEqual({ identifier: "config", type: "dict" });
        expect(result).not.toContainEqual({
          identifier: "config",
          type: "str",
        });
      });
    });
  });

  describe("given variables in any order in template text", () => {
    describe("when merging", () => {
      it("sorts inputs alphabetically by identifier", () => {
        const result = mergeAutoDetectedInputs({
          prompt: "{{zebra}} {{alpha}} {{middle}}",
          messages: [],
          inputs: [],
        });

        const identifiers = result.map((i) => i.identifier);
        expect(identifiers).toEqual(["alpha", "middle", "zebra"]);
      });
    });
  });

  describe("given a CLI default input that does not appear in template", () => {
    describe("when merging", () => {
      it("keeps the CLI default input alongside auto-detected variables", () => {
        const result = mergeAutoDetectedInputs({
          prompt: "hello {{name}}",
          messages: [],
          inputs: [{ identifier: "input", type: "str" }],
        });

        const identifiers = result.map((i) => i.identifier);
        expect(identifiers).toContain("input");
        expect(identifiers).toContain("name");
      });
    });
  });

  describe("given a complex real-world prompt (altura-demo)", () => {
    describe("when extracting and merging variables", () => {
      it("detects all template variables and excludes loop iterators", () => {
        const systemMessage = [
          "# dto_schema:",
          "{{ dto_schema }}",
          "",
          "# Example candidates:",
          "{{ example_candidates }}",
          "",
          "{% for col in column_headers %}- {{ col.column_name }} (ID: {{ col.column_id }})",
          "{% endfor %}",
        ].join("\n");

        const result = mergeAutoDetectedInputs({
          prompt: systemMessage,
          messages: [{ role: "user", content: "{{ input }}" }],
          inputs: [],
        });

        const identifiers = result.map((i) => i.identifier);
        expect(identifiers).toContain("column_headers");
        expect(identifiers).toContain("dto_schema");
        expect(identifiers).toContain("example_candidates");
        expect(identifiers).toContain("input");
        expect(identifiers).not.toContain("col");

        // All should default to type "str"
        for (const input of result) {
          expect(input.type).toBe("str");
        }

        // Should be sorted alphabetically
        expect(identifiers).toEqual([...identifiers].sort());
      });
    });
  });
});
