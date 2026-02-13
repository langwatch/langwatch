import { describe, it, expect } from "vitest";
import { promptResponseFactory } from "../../../../../__tests__/factories/prompt.factory";
import { Prompt, PromptCompilationError } from "../prompt";

/**
 * Helper to create a Prompt with a given template string as the system message.
 * The Prompt constructor auto-extracts system message content into `prompt`.
 */
function promptWithTemplate(template: string): Prompt {
  return new Prompt(
    promptResponseFactory.build({
      prompt: template,
      messages: [{ role: "system", content: template }],
    })
  );
}

describe("Prompt", () => {
  describe("Liquid template support", () => {
    describe("#compile()", () => {
      describe("when template has if/else conditions", () => {
        it("renders the matching branch", () => {
          const prompt = promptWithTemplate(
            "{% if tone == 'formal' %}Dear user{% else %}Hey{% endif %}, welcome!"
          );

          const result = prompt.compile({ tone: "formal" });

          expect(result.prompt).toBe("Dear user, welcome!");
        });
      });

      describe("when template has for loops over arrays", () => {
        it("renders each item with separator", () => {
          const prompt = promptWithTemplate(
            "Topics: {% for item in topics %}{{ item }}{% unless forloop.last %}, {% endunless %}{% endfor %}"
          );

          const result = prompt.compile({
            topics: ["AI", "ML", "NLP"],
          });

          expect(result.prompt).toBe("Topics: AI, ML, NLP");
        });
      });

      describe("when template has assign tags", () => {
        it("renders assigned and input variables", () => {
          const prompt = promptWithTemplate(
            "{% assign greeting = 'Hello' %}{{ greeting }}, {{ name }}!"
          );

          const result = prompt.compile({ name: "Alice" });

          expect(result.prompt).toBe("Hello, Alice!");
        });
      });

      describe("when template has filters", () => {
        it("applies upcase and truncate filters", () => {
          const prompt = promptWithTemplate(
            "{{ name | upcase }} - {{ description | truncate: 22 }}"
          );

          const result = prompt.compile({
            name: "alice",
            description: "This is a very long description text",
          });

          expect(result.prompt).toBe("ALICE - This is a very long...");
        });
      });

      describe("when template has nested conditions and loops", () => {
        it("renders only items matching the condition", () => {
          const prompt = promptWithTemplate(
            "{% for user in users %}{% if user.active %}{{ user.name }}{% endif %}{% endfor %}"
          );

          const result = prompt.compile({
            users: [
              { name: "Alice", active: true },
              { name: "Bob", active: false },
              { name: "Carol", active: true },
            ],
          });

          expect(result.prompt).toBe("AliceCarol");
        });
      });

      describe("when template has undefined variables in Liquid tags", () => {
        it("tolerates them and renders remaining content", () => {
          const prompt = promptWithTemplate(
            "{% if mood == 'happy' %}Great!{% endif %} Hello"
          );

          const result = prompt.compile({});

          expect(result.prompt).toBe(" Hello");
        });
      });
    });

    describe("#compileStrict()", () => {
      describe("when template has undefined variables in Liquid tags", () => {
        it("throws a PromptCompilationError", () => {
          const prompt = promptWithTemplate(
            "{% if mood == 'happy' %}Great!{% endif %}"
          );

          expect(() => {
            prompt.compileStrict({});
          }).toThrow(PromptCompilationError);
        });
      });
    });
  });
});
