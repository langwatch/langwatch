import { afterAll, describe, expect, it } from "vitest";

import {
  defineRule,
  renderEscapeTail,
  renderMessage,
  renderTemplate,
  WHY_MAX_LENGTH,
} from "../src/define-rule.mjs";
import { createFixtureWorkspace, runRule } from "../src/testing.mjs";

const workspace = createFixtureWorkspace({
  features: { agent: { layoutVersion: 0, roles: { process: {}, browser: {} } } },
});

afterAll(() => workspace.cleanup());

function ruleReportingOn(nodeType, { applies } = {}) {
  return defineRule({
    name: "fixture-rule",
    applies,
    messages: {
      named: {
        what: "`{{name}}` is declared at the top level of {{path}}.",
        why: "A top-level declaration is a module's public surface.",
        fix: "Move it onto the class.",
      },
    },
    options: { max: { type: "integer", minimum: 0, default: 3 } },
    create(context, file, options) {
      return {
        [nodeType]: (node) => {
          context.report({
            node,
            messageId: "named",
            data: { name: node.id?.name ?? String(options.max), path: file.workspacePath },
          });
        },
      };
    },
  });
}

describe("given a rule declared through defineRule", () => {
  describe("when a message is rendered", () => {
    /** @scenario "Every finding prints what, a one-line why and fix" */
    it("joins what, why and fix in that order", () => {
      expect(renderTemplate({ what: "A is wrong.", why: "Because.", fix: "Do B." })).toBe(
        "A is wrong. Because. Do B.",
      );
    });

    it("substitutes placeholders from the report data", () => {
      expect(renderMessage("`{{name}}` in {{path}}.", { name: "x", path: "y" })).toBe("`x` in y.");
    });

    it("leaves a placeholder the report did not supply alone", () => {
      expect(renderMessage("{{name}} and {{other}}", { name: "x" })).toBe("x and {{other}}");
    });
  });

  describe("when the rule object is built", () => {
    it("derives meta.messages from what, why and fix", () => {
      expect(ruleReportingOn("FunctionDeclaration").meta.messages).toEqual({
        named:
          "`{{name}}` is declared at the top level of {{path}}." +
          " A top-level declaration is a module's public surface. Move it onto the class.",
      });
    });

    it("derives meta.schema from the declared options", () => {
      expect(ruleReportingOn("FunctionDeclaration").meta.schema).toEqual([
        {
          type: "object",
          properties: { max: { type: "integer", minimum: 0 } },
          additionalProperties: false,
        },
      ]);
    });

    it("keeps what, why and fix on meta.docs so documentation can be generated", () => {
      const docs = ruleReportingOn("FunctionDeclaration").meta.docs;

      expect(docs.name).toBe("fixture-rule");
      expect(docs.messages.named.why).toBe("A top-level declaration is a module's public surface.");
    });
  });

  describe("when the rule runs", () => {
    it("hands the create function the classification and the resolved options", () => {
      const found = runRule(ruleReportingOn("FunctionDeclaration"), {
        code: "export function alpha() { return 1; }",
        cwd: workspace.cwd,
        filename: "modules/agent/process/src/services/agent.service.ts",
      });

      expect(found[0].message).toBe(
        "`alpha` is declared at the top level of" +
          " modules/agent/process/src/services/agent.service.ts." +
          " A top-level declaration is a module's public surface. Move it onto the class.",
      );
    });

    it("prefers a caller option over the declared default", () => {
      const found = runRule(ruleReportingOn("ClassDeclaration"), {
        code: "export class Alpha {}",
        cwd: workspace.cwd,
        filename: "modules/agent/process/src/services/agent.service.ts",
        options: [{ max: 9 }],
      });

      expect(found[0].data.name).toBe("Alpha");
    });
  });

  describe("when applies rejects the file", () => {
    it("returns no visitors at all", () => {
      const rule = ruleReportingOn("FunctionDeclaration", {
        applies: (file) => file.role === "browser",
      });
      const found = runRule(rule, {
        code: "export function alpha() { return 1; }",
        cwd: workspace.cwd,
        filename: "modules/agent/process/src/services/agent.service.ts",
      });

      expect(found).toEqual([]);
    });

    it("still runs on a file it accepts", () => {
      const rule = ruleReportingOn("FunctionDeclaration", {
        applies: (file) => file.role === "browser",
      });
      const found = runRule(rule, {
        code: "export function alpha() { return 1; }",
        cwd: workspace.cwd,
        filename: "modules/agent/browser/src/behavior/agent-api.ts",
      });

      expect(found).toHaveLength(1);
    });
  });

  describe("when a message gives no one-line why", () => {
    const declaring = (why) => () =>
      defineRule({
        name: "whyless-rule",
        messages: { bare: { what: "A is wrong.", why, fix: "Do B." } },
        create: () => ({}),
      });

    /** @scenario "A message without a one-line why is refused when the rule is declared" */
    it("refuses a missing, empty, multi-line or over-long why", () => {
      expect(declaring(undefined)).toThrow(/whyless-rule\/bare gives no `why`/);
      expect(declaring("  ")).toThrow(/gives no `why`/);
      expect(declaring("One.\nTwo.")).toThrow(/longer than one line/);
      expect(declaring("x".repeat(WHY_MAX_LENGTH + 1))).toThrow(/longer than one line/);
      expect(declaring("x".repeat(WHY_MAX_LENGTH))).not.toThrow();
    });
  });

  describe("when a rule opts in to a justified disable", () => {
    const escapable = (escape) =>
      defineRule({
        name: "escapable-rule",
        escape,
        messages: {
          drift: {
            what: "The binding parses the body.",
            why: "The framework parses it.",
            fix: "Use `.withInput`.",
          },
        },
        create: () => ({}),
      });

    /** @scenario "An escapable rule's message ends with the one escape sentence" */
    it("appends the escape sentence after what, why and fix", () => {
      const rule = escapable({ framework: "the API framework" });

      expect(rule.meta.messages.drift).toBe(
        "The binding parses the body. The framework parses it. Use `.withInput`." +
          " If the API framework genuinely cannot" +
          " express this case, extend it, or disable this line with `-- <why it cannot>`; if the" +
          " case is confusing, stop and ask the human before disabling.",
      );
      expect(rule.meta.docs.escape).toEqual({ framework: "the API framework" });
    });

    it("renders the tail as one sentence naming the framework", () => {
      expect(renderEscapeTail({ framework: "X" })).toMatch(/^If X genuinely cannot[^.]*\.$/);
    });

    it("refuses an escape that names no framework", () => {
      expect(() => escapable({ framework: " " })).toThrow(/escape\.framework/);
    });
  });

  describe("when a rule does not opt in", () => {
    /** @scenario "A house rule's message carries no escape sentence" */
    it("prints what, why and fix alone and records no escape", () => {
      const rule = ruleReportingOn("FunctionDeclaration");

      expect(rule.meta.messages.named).not.toMatch(/disable/);
      expect(rule.meta.docs.escape).toBeUndefined();
    });
  });
});
