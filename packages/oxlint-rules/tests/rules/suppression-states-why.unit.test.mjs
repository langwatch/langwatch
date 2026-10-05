import { afterAll, describe, expect, it } from "vitest";

import { defineRule } from "../../src/define-rule.mjs";
import { rules } from "../../src/index.mjs";
import {
  isRealReason,
  parseDisableDirective,
  suppressionStatesWhyRuleFor,
} from "../../src/rules/suppression-states-why.rule.mjs";
import { createFixtureWorkspace, runRule } from "../../src/testing.mjs";

const workspace = createFixtureWorkspace({});

afterAll(() => workspace.cleanup());

function houseRule({ escape, name }) {
  return defineRule({
    name,
    escape,
    messages: { found: { what: "Found.", fix: "Fix it." } },
    create: () => ({}),
  });
}

const rule = suppressionStatesWhyRuleFor({
  houseRules: [
    houseRule({ name: "strict-rule" }),
    houseRule({ name: "open-route", escape: { framework: "the API framework" } }),
  ],
});

function report(code, filename = "modules/x/process/src/services/y.service.ts") {
  return runRule(rule, { code, cwd: workspace.cwd, filename });
}

const REASON = "the webhook signature needs the exact raw bytes";

describe("given a disable directive naming a house rule that did not opt in", () => {
  describe("when it carries a reason", () => {
    /** @scenario "A disable naming a strict house rule is reported" */
    it("reports houseRuleDisabled, because the reason does not make it ignorable", () => {
      const found = report(
        `// oxlint-disable-next-line langwatch/strict-rule -- ${REASON}\nexport const a = 1;`,
      );

      expect(found.map((entry) => [entry.messageId, entry.line])).toEqual([
        ["houseRuleDisabled", 1],
      ]);
      expect(found[0].message).toBe(
        "`oxlint-disable-next-line` turns off `langwatch/strict-rule`, a house rule that cannot" +
          " be disabled. Delete the directive and change the code the way" +
          " `langwatch/strict-rule`'s own message says; if the case is confusing, stop and ask" +
          " the human instead of disabling it.",
      );
    });
  });

  describe("when the eslint block spelling names it beside another plugin's rule", () => {
    it("reports the house rule only", () => {
      const found = report(
        "/* eslint-disable no-console, langwatch/strict-rule */\nexport const a = 1;",
      );

      expect(found.map((entry) => [entry.messageId, entry.data.rule])).toEqual([
        ["houseRuleDisabled", "langwatch/strict-rule"],
      ]);
    });
  });

  describe("when it names the suppression rule itself", () => {
    it("reports it, because the guard is a house rule too", () => {
      const found = report(
        `const a = 1; // oxlint-disable-line langwatch/suppression-states-why -- ${REASON}`,
      );

      expect(found.map((entry) => entry.messageId)).toEqual(["houseRuleDisabled"]);
    });
  });
});

describe("given a disable directive naming a rule that opted in", () => {
  describe("when it gives no reason", () => {
    /** @scenario "A bare disable of an escapable rule is reported" */
    it("reports reasonMissing", () => {
      const found = report("// eslint-disable-next-line langwatch/open-route\nexport const a = 1;");

      expect(found.map((entry) => entry.messageId)).toEqual(["reasonMissing"]);
      expect(found[0].message).toBe(
        "`eslint-disable-next-line langwatch/open-route` gives no reason. Append" +
          " `-- <why the framework cannot express this case>` as a sentence of at least 5 words;" +
          " if you cannot say why, delete the directive and use the shape" +
          " `langwatch/open-route` names, and if the case is confusing, stop and ask the human.",
      );
    });
  });

  describe("when the reason is a placeholder or too short", () => {
    /** @scenario "A placeholder reason is reported" */
    it("reports reasonVague with the reason quoted", () => {
      for (const reason of ["todo", "temporary", "fix later", "legacy", "false positive"]) {
        const found = report(`// oxlint-disable-next-line langwatch/open-route -- ${reason}\n1;`);

        expect(found.map((entry) => [entry.messageId, entry.data.reason])).toEqual([
          ["reasonVague", reason],
        ]);
      }
    });

    it("does not count placeholder words towards the five", () => {
      expect(isRealReason("temporary legacy hack fix later todo")).toBe(false);
      expect(isRealReason("only four real words")).toBe(false);
    });
  });

  describe("when the reason is a real sentence", () => {
    /** @scenario "A disable of an escapable rule with a real reason passes" */
    it("reports nothing", () => {
      const code = `// oxlint-disable-next-line langwatch/open-route -- ${REASON}\n1;`;

      expect(report(code)).toEqual([]);
    });
  });
});

describe("given directives the house grammar does not govern", () => {
  describe("when a disable names only another plugin's rule", () => {
    /** @scenario "A disable of another plugin's rule is left alone" */
    it("reports nothing, with or without a reason", () => {
      const code = [
        "// eslint-disable-next-line react-hooks/exhaustive-deps",
        "// oxlint-disable-next-line no-console -- todo",
        "/* oxlint-disable */",
        "export const a = 1;",
      ].join("\n");

      expect(report(code)).toEqual([]);
    });
  });

  describe("when a comment mentions a directive without being one", () => {
    it("reports nothing", () => {
      expect(report("// see oxlint-disable-next-line langwatch/strict-rule\n1;")).toEqual([]);
      expect(report("// oxlint-disable-next-lines langwatch/strict-rule\n1;")).toEqual([]);
    });
  });

  describe("when the file is generated", () => {
    it("reports nothing", () => {
      const code = "// oxlint-disable-next-line langwatch/strict-rule\n1;";

      expect(report(code, "packages/x/src/schema.generated.ts")).toEqual([]);
    });
  });
});

describe("given the directive grammar", () => {
  it("splits the rules from the reason on a spaced double dash", () => {
    expect(parseDisableDirective(" oxlint-disable-line a/b, c/d -- why it is so")).toEqual({
      directive: "oxlint-disable-line",
      reason: "why it is so",
      ruleNames: ["a/b", "c/d"],
    });
  });
});

describe("given the registered plugin", () => {
  /** @scenario "No house rule opts in to a disable yet" */
  it("holds the guard and no existing rule that accepts a disable", () => {
    expect(rules["suppression-states-why"]).toBeDefined();
    expect(Object.values(rules).filter((entry) => entry.meta.docs.escape)).toEqual([]);
  });
});
