/**
 * Spec: specs/tooling/lint-teaching-citations.feature. Each test writes a fixture tree (a
 * record, a rule, a registry and a skill that exist) and one page citing them.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  lintLintRuleSkillPointers,
  lintTeachingCitations,
  RECORD,
  RULES_DIRECTORY,
} from "../src/policies/quality/teaching-citations.ts";
import { MissingAnchorError } from "../src/workspace/anchors.ts";
import { snapshotOf } from "./workspace.ts";

let root = "";

function write({ path, content }: { path: string; content: string }): void {
  const file = join(root, path);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, content, "utf8");
}

function rule({ name, fix }: { name: string; fix: string }): string {
  return `export const r = defineRule({\n  name: "${name}",\n  messages: { m: { what: "x", fix: "${fix}" } },\n});\n`;
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "langwatch-teaching-citations-"));
  write({ path: RECORD, content: "# Record\n\n## 3. A module\n\n### 3.2 The process half\n" });
  write({
    path: `${RULES_DIRECTORY}/module-layers.rule.mjs`,
    content: rule({ name: "module-layers", fix: "Read the `module` skill." }),
  });
  write({ path: ".claude/skills/module/SKILL.md", content: "---\nname: module\n---\n# Module\n" });
  write({ path: "modules/billing/process/src/billing.module.ts", content: "" });
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function page(content: string) {
  write({ path: ".claude/skills/teaching/SKILL.md", content });

  return lintTeachingCitations(snapshotOf({ root })).map((finding) => finding.specifier);
}

describe("teaching-citations", () => {
  describe("when a page cites a rule, a policy, a section, a skill and a path that exist", () => {
    /** @scenario "A citation of something that exists passes" */
    it("reports nothing", () => {
      expect(
        page(
          [
            "Backed by `langwatch/module-layers` and policy `peer-cycles`; read §3.2 and the `module` skill.",
            "The module class is `modules/billing/process/src/billing.module.ts:12`.",
          ].join("\n"),
        ),
      ).toEqual([]);
    });
  });

  describe("when a page cites a lint rule that is not declared", () => {
    /** @scenario "A cited lint rule that does not exist fails" */
    it("reports the rule", () => {
      expect(page("Backed by `langwatch/module-tiers`.")).toEqual(["rule:module-tiers"]);
    });
  });

  describe("when a Backed-by column names a rule, a policy and a skill", () => {
    /** @scenario "A Backed-by column is read by kind" */
    it("checks bare rules against rules and skills, and policies against the registry", () => {
      const table = [
        "| Rule | Backed by |",
        "| ---- | --------- |",
        "| Layers | `module-layers`, `module` (`aside-not-a-rule`) |",
        "| Cycles | policy `peer-cycle`; boot `config_collision` |",
        "| Tiers | `module-tiers`; `unbacked` |",
        "| Into | runtime: nested `into` is `unbacked` |",
      ].join("\n");

      expect(page(table)).toEqual(["policy:peer-cycle", "backing:module-tiers"]);
    });
  });

  describe("when a page cites a record section with no heading", () => {
    /** @scenario "A cited record section that does not exist fails" */
    it("reports the section, and leaves another document's section alone", () => {
      expect(page("See §3.7 and §3, and ADR-150 §9.")).toEqual(["section:3.7"]);
    });
  });

  describe("when a page cites a skill with no folder", () => {
    /** @scenario "A cited skill that does not exist fails" */
    it("reports the skill, and passes a skill the harness ships", () => {
      expect(page("Load the `haven-setup` skill, then the `code-review` skill.")).toEqual([
        "skill:haven-setup",
      ]);
    });
  });

  describe("when a page cites a repository path that is not in the tree", () => {
    /** @scenario "A cited repository path that does not exist fails" */
    it("reports the path", () => {
      expect(page("Edit `modules/billing/process/src/billing.service.ts`.")).toEqual([
        "path:modules/billing/process/src/billing.service.ts",
      ]);
    });
  });

  describe("when a path cites placeholder and glob segments", () => {
    /** @scenario "Placeholder and glob segments match any name" */
    it("passes when some folder matches, and fails when none does", () => {
      expect(
        page(
          [
            "`modules/<name>/process/src/` and `modules/*/process/src/*.module.ts` and `modules/**/x`.",
            "`modules/<name>/browser/src/`.",
          ].join("\n"),
        ),
      ).toEqual(["path:modules/<name>/browser/src/"]);
    });
  });

  describe("when a citation sits in a fence, a retired sentence or a module-relative path", () => {
    /** @scenario "Retired mentions, code samples and module-relative paths are not citations" */
    it("reports nothing", () => {
      const source = [
        "```",
        "langwatch/module-tiers §42",
        "```",
        "The former `haven-setup` skill moved here.",
        "",
        "Never write to `.claude/worktrees/`.",
        "",
        "A service is `services/billing.service.ts`.",
      ].join("\n");

      expect(page(source)).toEqual([]);
    });
  });

  describe("when the record is missing", () => {
    /** @scenario "A missing anchor refuses the run" */
    it("throws naming the policy", () => {
      rmSync(join(root, RECORD));

      expect(() => page("§3")).toThrow(MissingAnchorError);
    });
  });
});

describe("lint-rule-skill-pointers", () => {
  describe("when one rule's message names a skill and another's does not", () => {
    /** @scenario "A house rule whose message names no skill is reported" */
    it("reports only the rule with no skill, comments not counting", () => {
      write({
        path: `${RULES_DIRECTORY}/no-redux.rule.mjs`,
        content: `// Read the module skill.\n${rule({ name: "no-redux", fix: "Use zustand." })}`,
      });

      expect(
        lintLintRuleSkillPointers(snapshotOf({ root })).map((finding) => finding.specifier),
      ).toEqual(["langwatch/no-redux"]);
    });
  });
});
