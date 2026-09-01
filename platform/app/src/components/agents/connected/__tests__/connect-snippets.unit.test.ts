/**
 * The snippets a person copies out of the connect panel.
 *
 * An agent name is any text of up to 64 characters, so these check that a
 * name never escapes the string literal it sits in, and that the declaration
 * the snippet writes is one the language accepts.
 *
 * @see specs/features/agents/connected-agents-ui.feature
 */

import { describe, expect, it } from "vitest";
import { pythonSnippet, typescriptSnippet } from "../connect-snippets";

describe("connect snippets", () => {
  describe("given an agent name that holds a quote", () => {
    /** @scenario "A snippet carries the agent name as written" */
    it("keeps the name inside its literal", () => {
      const name = 'a", "b';

      const python = pythonSnippet({ name });
      const typescript = typescriptSnippet({ name });

      expect(python).toContain('name="a\\", \\"b"');
      expect(typescript).toContain('name: "a\\", \\"b"');
    });
  });

  describe("given an agent name that holds a line break", () => {
    /** @scenario "A snippet carries the agent name as written" */
    it("writes the break as an escape and keeps the snippet on its own lines", () => {
      const python = pythonSnippet({ name: "one\ntwo" });

      expect(python).toContain('name="one\\ntwo"');
      expect(python.split("\n")).toHaveLength(5);
    });
  });

  describe("given an environment that holds a quote", () => {
    /** @scenario "A snippet carries the agent name as written" */
    it("keeps the environment inside its literal", () => {
      const python = pythonSnippet({ name: "agent", environment: 'x"y' });

      expect(python).toContain('environment="x\\"y"');
    });
  });

  describe("given an agent name of digits alone", () => {
    /** @scenario "A snippet declares a name the language accepts" */
    it("declares the fallback name", () => {
      expect(pythonSnippet({ name: "123" })).toContain("def my_agent(");
      expect(typescriptSnippet({ name: "123" })).toContain(
        "export const myAgent =",
      );
    });
  });

  describe("given an agent name that reads as a keyword", () => {
    /** @scenario "A snippet declares a name the language accepts" */
    it("declares the fallback name", () => {
      expect(pythonSnippet({ name: "class" })).toContain("def my_agent(");
      expect(typescriptSnippet({ name: "return" })).toContain(
        "export const myAgent =",
      );
    });
  });

  describe("given an agent name a keyword of one language alone", () => {
    /** @scenario "A snippet declares a name the language accepts" */
    it("declares the fallback name in both snippets", () => {
      for (const name of [
        "async",
        "interface",
        "assert",
        "nonlocal",
        "static",
        "true",
        "null",
      ]) {
        expect(pythonSnippet({ name })).toContain("def my_agent(");
        expect(typescriptSnippet({ name })).toContain("export const myAgent =");
      }
    });
  });

  describe("given an ordinary agent name", () => {
    /** @scenario "A snippet carries the agent name as written" */
    it("declares it and names it unchanged", () => {
      const python = pythonSnippet({ name: "support-agent" });

      expect(python).toContain('name="support-agent"');
      expect(python).toContain("def support_agent(");
    });
  });
});
