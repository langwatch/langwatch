import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { rules } from "../oxlint-plugin.mjs";
import { LINT_RULES_DOC, renderLintRuleDocs, workspaceRoot } from "../src/lint-rules-doc.mjs";

const committed = readFileSync(join(workspaceRoot, LINT_RULES_DOC), "utf8");

describe("given the generated lint-rule reference", () => {
  describe("when the committed file is compared with the render", () => {
    /** @scenario "The committed reference matches the render" */
    it("matches byte for byte", () => {
      expect(committed).toBe(renderLintRuleDocs());
    });
  });

  describe("when a rule changes without the doc being regenerated", () => {
    /** @scenario "A changed rule message no longer matches the committed reference" */
    it("no longer matches the render", () => {
      const [name] = Object.keys(rules);
      const rule = rules[name];
      const [id] = Object.keys(rule.meta.docs.messages);
      const original = rule.meta.docs.messages[id].fix;
      rule.meta.docs.messages[id].fix = "Do something else entirely.";
      try {
        expect(renderLintRuleDocs()).not.toBe(committed);
      } finally {
        rule.meta.docs.messages[id].fix = original;
      }
    });
  });

  describe("when a rule carries no bound spec", () => {
    /** @scenario "A rule without a spec renders as none yet" */
    it("renders none yet rather than a broken path", () => {
      expect(renderLintRuleDocs(join(workspaceRoot, "packages/architecture-enforcer"))).toContain(
        "- Spec: none yet",
      );
    });
  });
});
