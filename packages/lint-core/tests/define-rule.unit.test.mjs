import { afterAll, describe, expect, it } from "vitest";
import { defineRule, renderMessage, renderTemplate } from "../src/define-rule.mjs";
import { createFixtureWorkspace, runRule } from "../src/testing.mjs";

const workspace = createFixtureWorkspace({
  features: { agent: { layoutVersion: 0, roles: { server: {}, web: {} } } },
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
    it("joins what and fix, and leaves why out of the printed message", () => {
      expect(renderTemplate({ what: "A is wrong.", why: "Because.", fix: "Do B." })).toBe(
        "A is wrong. Do B.",
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
    it("derives meta.messages from what plus fix", () => {
      expect(ruleReportingOn("FunctionDeclaration").meta.messages).toEqual({
        named: "`{{name}}` is declared at the top level of {{path}}. Move it onto the class.",
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
        filename: "packages/features/agent/server/src/services/agent.service.ts",
      });

      expect(found[0].message).toBe(
        "`alpha` is declared at the top level of" +
          " packages/features/agent/server/src/services/agent.service.ts." +
          " Move it onto the class.",
      );
    });

    it("prefers a caller option over the declared default", () => {
      const found = runRule(ruleReportingOn("ClassDeclaration"), {
        code: "export class Alpha {}",
        cwd: workspace.cwd,
        filename: "packages/features/agent/server/src/services/agent.service.ts",
        options: [{ max: 9 }],
      });

      expect(found[0].data.name).toBe("Alpha");
    });
  });

  describe("when applies rejects the file", () => {
    it("returns no visitors at all", () => {
      const rule = ruleReportingOn("FunctionDeclaration", {
        applies: (file) => file.role === "web",
      });
      const found = runRule(rule, {
        code: "export function alpha() { return 1; }",
        cwd: workspace.cwd,
        filename: "packages/features/agent/server/src/services/agent.service.ts",
      });

      expect(found).toEqual([]);
    });

    it("still runs on a file it accepts", () => {
      const rule = ruleReportingOn("FunctionDeclaration", {
        applies: (file) => file.role === "web",
      });
      const found = runRule(rule, {
        code: "export function alpha() { return 1; }",
        cwd: workspace.cwd,
        filename: "packages/features/agent/web/src/behavior/agent-api.ts",
      });

      expect(found).toHaveLength(1);
    });
  });
});
