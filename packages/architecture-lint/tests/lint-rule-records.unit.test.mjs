import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { POLICIES } from "../src/policies/index.ts";

// ADR-135: every house rule has one address - a decision row in an ADR, a
// spec, and a bound scenario. This reads the three registries and the records
// and reports the pairs that do not exist.

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OXLINT_CONFIG = join(root, ".oxlintrc.architecture.json");

/** The decision-table shape ADR-135 fixes: this header row and no other table. */
const DECISION_HEADER = /^\|\s*Rule\s*\|\s*Layer\s*\|\s*Meaning\s*\|/;
const FIRST_CELL = /^\|\s*`([^`|]+)`\s*\|/;

function readLines(file) {
  return readFileSync(file, "utf8").split("\n");
}

/** The top-level `rules` block of the oxlint config, as raw lines. */
function workspaceRuleLines() {
  const lines = readLines(OXLINT_CONFIG);
  const start = lines.findIndex((line) => /^\s{2}"rules":\s*\{/.test(line));
  const end = lines.findIndex((line, index) => index > start && /^\s{2}\}/.test(line));

  return lines.slice(start + 1, end);
}

function registryRuleIds() {
  const pluginRules = readdirSync(join(root, "packages/lint-core/src/rules"))
    .filter((name) => name.endsWith(".rule.mjs"))
    .map((name) => `langwatch/${name.slice(0, -".rule.mjs".length)}`);

  const astGrepRules = readdirSync(join(root, "dev/lint/ast-grep/rules"))
    .filter((name) => name.endsWith(".yml"))
    .map((name) => {
      const declared = readFileSync(join(root, "dev/lint/ast-grep/rules", name), "utf8");
      return (declared.match(/^id:\s*(\S+)/m)?.[1] ?? "").replace(/-tsx?$/, "");
    });

  const policyIds = POLICIES.map((policy) => policy.id);

  const builtIns = workspaceRuleLines()
    .map((line) => line.match(/^\s*"([^"]+)":/)?.[1])
    .filter((id) => id !== void 0 && !id.startsWith("langwatch/"));

  return [...new Set([...pluginRules, ...astGrepRules, ...policyIds, ...builtIns])].sort();
}

/** Every rule id named in the first column of an ADR decision table. */
function adrDecisionRows() {
  const rows = new Map();
  for (const name of readdirSync(join(root, "dev/docs/adr")).filter((f) => f.endsWith(".md"))) {
    const lines = readLines(join(root, "dev/docs/adr", name));
    let inTable = false;
    for (const line of lines) {
      if (DECISION_HEADER.test(line)) {
        inTable = true;
        continue;
      }
      if (!inTable) continue;
      if (!line.trimStart().startsWith("|")) {
        inTable = false;
        continue;
      }
      const id = line.match(FIRST_CELL)?.[1];
      if (id) rows.set(id, name);
    }
  }

  return rows;
}

/** Every `Rule:` line under specs/tooling, by the rule ids it names in backticks. */
function specRuleBlocks() {
  const named = new Map();
  const dir = join(root, "specs/tooling");
  for (const name of readdirSync(dir).filter((f) => f.endsWith(".feature"))) {
    for (const line of readLines(join(dir, name))) {
      if (!line.trimStart().startsWith("Rule:")) continue;
      for (const [, id] of line.matchAll(/`([^`]+)`/g)) named.set(id, `specs/tooling/${name}`);
    }
  }

  return named;
}

/** Where a rule's behaviour is written down, or undefined when nowhere. */
function specRecordFor(id, blocks) {
  const named = blocks.get(id);
  if (named) return named;

  if (id.startsWith("langwatch/")) {
    const conventional = `specs/tooling/lint-${id.slice("langwatch/".length)}.feature`;
    if (existsSync(join(root, conventional))) return conventional;
  }

  const policy = POLICIES.find((entry) => entry.id === id);
  if (policy && existsSync(join(packageRoot, policy.spec))) {
    return `packages/architecture-lint/${policy.spec}`;
  }

  return void 0;
}

/**
 * The three drift failures, as messages. Pure so the failure modes can be
 * exercised on inputs rather than on whatever the tree happens to hold.
 */
export function missingRecords({ ruleIds, adrRows, specRecords }) {
  const messages = [];
  for (const id of ruleIds) {
    if (!adrRows.has(id)) {
      messages.push(`${id}: no ADR decision row. Add one to a table in dev/docs/adr.`);
    }
    if (!specRecords.has(id)) {
      messages.push(`${id}: no spec record. Add a Rule: block naming it under specs/tooling.`);
    }
  }
  for (const [id, adr] of adrRows) {
    if (!ruleIds.includes(id)) {
      messages.push(`${id}: named by a decision row in ${adr}, held by no registry.`);
    }
  }

  return messages;
}

const ruleIds = registryRuleIds();
const adrRows = adrDecisionRows();
const blocks = specRuleBlocks();
const specRecords = new Map(
  ruleIds.map((id) => [id, specRecordFor(id, blocks)]).filter(([, record]) => record !== void 0),
);

describe("given the three rule registries and the committed records", () => {
  describe("when the guard reads the ADR decision tables", () => {
    /** @scenario "Every registered rule has a decision row in an ADR" */
    it("finds a row for every registered rule", () => {
      const orphans = ruleIds.filter((id) => !adrRows.has(id));

      expect(orphans).toEqual([]);
    });

    /** @scenario "Every decision row names a rule that exists" */
    it("names no rule the registries do not hold", () => {
      const dangling = [...adrRows.keys()].filter((id) => !ruleIds.includes(id));

      expect(dangling).toEqual([]);
    });
  });

  describe("when the guard resolves each rule to its spec", () => {
    /** @scenario "Every registered rule has a spec record" */
    it("finds a feature file or a Rule block for every registered rule", () => {
      const unspecified = ruleIds.filter((id) => !specRecords.has(id));

      expect(unspecified).toEqual([]);
    });
  });
});

describe("given a registry and a set of records that disagree", () => {
  const records = () => ({
    ruleIds: ["langwatch/temporal-only"],
    adrRows: new Map([["langwatch/temporal-only", "141-platform-invariants.md"]]),
    specRecords: new Map([["langwatch/temporal-only", "specs/tooling/lint-temporal-only.feature"]]),
  });

  describe("when a rule has no decision row", () => {
    /** @scenario "A rule with no decision row is reported" */
    it("names the rule and the record it lacks", () => {
      const input = records();
      input.ruleIds.push("langwatch/new-rule");

      expect(missingRecords(input)).toContain(
        "langwatch/new-rule: no ADR decision row. Add one to a table in dev/docs/adr.",
      );
    });
  });

  describe("when a decision row names a deleted rule", () => {
    /** @scenario "A decision row for a deleted rule is reported" */
    it("names the rule and the ADR that still claims it", () => {
      const input = records();
      input.adrRows.set("langwatch/deleted-rule", "137-module-source-grammar.md");

      expect(missingRecords(input)).toContain(
        "langwatch/deleted-rule: named by a decision row in 137-module-source-grammar.md, held by no registry.",
      );
    });
  });

  describe("when a rule has no spec", () => {
    /** @scenario "A rule with no spec is reported" */
    it("names the rule and the record it lacks", () => {
      const input = records();
      input.specRecords.delete("langwatch/temporal-only");

      expect(missingRecords(input)).toContain(
        "langwatch/temporal-only: no spec record. Add a Rule: block naming it under specs/tooling.",
      );
    });
  });
});

describe("given the workspace-wide oxlint rules", () => {
  const workspaceRules = workspaceRuleLines().join("\n");

  describe("when the complexity budgets are read", () => {
    /** @scenario "The cyclomatic budget is declared workspace-wide at 25" */
    it("declares the built-in branch counter at 25", () => {
      expect(workspaceRules).toMatch(/"complexity":\s*\["error",\s*\{\s*"max":\s*25\s*\}\]/);
    });

    /** @scenario "The cognitive budget is declared workspace-wide at 15" */
    it("declares the cognitive counter at 15", () => {
      expect(workspaceRules).toMatch(
        /"langwatch\/cognitive-complexity":\s*\["error",\s*\{\s*"max":\s*15\s*\}\]/,
      );
    });
  });

  describe("when the class-A migrated built-ins are read", () => {
    /** @scenario "The nested ternary rule is enabled workspace-wide" */
    it("enables the built-in no-nested-ternary rule", () => {
      expect(workspaceRules).toMatch(/"no-nested-ternary":\s*"error"/);
    });

    /** @scenario "The ambient-undefined rule is not in the workspace-wide config" */
    it("does not enable the built-in no-undefined rule", () => {
      expect(workspaceRules).not.toMatch(/"no-undefined":/);
    });

    /** @scenario "The explicit-any rule is not in the workspace-wide config" */
    it("does not enable the built-in typescript/no-explicit-any rule", () => {
      expect(workspaceRules).not.toMatch(/"typescript\/no-explicit-any":/);
    });

    /** @scenario "The assertion-coverage rule carries no explicit config line" */
    it("does not add an explicit vitest/expect-expect line", () => {
      expect(workspaceRules).not.toMatch(/"vitest\/expect-expect":/);
    });
  });
});

describe("given the formatter configuration", () => {
  const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  const oxfmtrc = JSON.parse(readFileSync(join(root, ".oxfmtrc.json"), "utf8"));

  describe("when the format scripts are read", () => {
    /** @scenario "Both format scripts disable nested configuration" */
    it("passes --disable-nested-config from both", () => {
      expect(manifest.scripts.format).toContain("--disable-nested-config");
      expect(manifest.scripts["format:check"]).toContain("--disable-nested-config");
    });
  });

  describe("when the declared style is read", () => {
    /** @scenario "The formatter configuration matches the recorded style" */
    it("matches the style ADR-143 records", () => {
      expect({
        printWidth: oxfmtrc.printWidth,
        tabWidth: oxfmtrc.tabWidth,
        useTabs: oxfmtrc.useTabs,
        semi: oxfmtrc.semi,
        singleQuote: oxfmtrc.singleQuote,
        trailingComma: oxfmtrc.trailingComma,
      }).toEqual({
        printWidth: 100,
        tabWidth: 2,
        useTabs: false,
        semi: true,
        singleQuote: false,
        trailingComma: "all",
      });
    });
  });
});
