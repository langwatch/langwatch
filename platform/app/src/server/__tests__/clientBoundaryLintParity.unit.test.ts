/**
 * @vitest-environment node
 *
 * @see specs/setup/memory-footprint.feature — "The lint rule and the transitive
 * guard ban the same packages"
 *
 * The client/server boundary is enforced twice, on purpose:
 *
 *   - `dev/lint/ast-grep/rules/no-client-imports-in-server{,-tsx}.yml` refuses
 *     the direct import as it is typed, in `make lint-rules` and the CI
 *     `ast-grep` job;
 *   - `frontend-boundary.unit.test.ts` walks the real import graph and catches
 *     the transitive chain a single-file linter cannot see.
 *
 * Neither subsumes the other. The leak that motivated the guard was a route
 * importing one constant from a component, which pulled the whole UI stack in
 * behind it — a linter reading one file at a time sees only the first hop. So
 * both have to keep a list of browser-only packages, and the lists have to
 * agree. A package added to one and not the other is the failure this test
 * exists for: the tree still looks guarded, and the half that was not updated
 * waves the import straight through.
 *
 * This compares the package lists only. It deliberately does NOT compare the
 * client source trees (`components/`, `hooks/`, `stores/`), because those are
 * genuinely different jobs — the rule matches specifier text, the walker
 * resolves paths on disk — and forcing them into one shape would mean weakening
 * one of them.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "../../../../..");
const RULES_DIR = path.join(REPO_ROOT, "dev/lint/ast-grep/rules");

const GUARD_TEST = path.join(HERE, "frontend-boundary.unit.test.ts");
const RULE_TS = path.join(RULES_DIR, "no-client-imports-in-server.yml");
const RULE_TSX = path.join(RULES_DIR, "no-client-imports-in-server-tsx.yml");

/**
 * The walker's list, read out of its `BROWSER_ONLY` array literal.
 *
 * Every extractor here throws rather than returning empty when its anchor is
 * missing. A parity test that quietly finds nothing on both sides compares two
 * empty sets, passes forever, and is worse than no test at all — it reports
 * that a drift check is running when none is.
 */
const readWalkerPackages = (): string[] => {
  const source = fs.readFileSync(GUARD_TEST, "utf8");
  const block = /const BROWSER_ONLY = \[([\s\S]*?)\];/.exec(source);
  if (!block?.[1]) {
    throw new Error(
      `Could not find the BROWSER_ONLY array in ${GUARD_TEST}. If it was renamed or reshaped, update this extractor — do not delete the check.`,
    );
  }
  const names = [...block[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]!);
  if (names.length === 0) {
    throw new Error(`BROWSER_ONLY in ${GUARD_TEST} parsed as empty.`);
  }
  return names;
};

/**
 * The `utils:` block of an ast-grep rule, stripped of comments and blank lines.
 *
 * Comments are dropped so the two rules can be documented differently while
 * still being compared for semantic identity.
 */
const readUtilsBlock = (file: string): string => {
  const source = fs.readFileSync(file, "utf8");
  const block = /^utils:\n([\s\S]*?)^rule:/m.exec(source);
  if (!block?.[1]) {
    throw new Error(
      `Could not find the utils: block in ${file}. If the rule was reshaped, update this extractor — do not delete the check.`,
    );
  }
  return block[1]
    .split("\n")
    .filter((line) => line.trim() && !line.trim().startsWith("#"))
    .join("\n");
};

/**
 * The rule's package list, read out of the alternation inside `banned-source`.
 *
 * The pattern is anchored on the closing quote — that anchoring is what keeps
 * `reactflow` and `@react-email/*` out of a rule that bans `react` — and the
 * package alternation is the first inner group, before the client-tree
 * alternatives. YAML doubles single quotes inside a single-quoted scalar, so
 * they are collapsed first.
 */
const readRulePackages = (): string[] => {
  const utils = readUtilsBlock(RULE_TS).replace(/''/g, "'");
  const alternation = /\(\?:\(\?:([^)]+)\)/.exec(utils);
  if (!alternation?.[1]) {
    throw new Error(
      `Could not parse the package alternation in banned-source. Raw utils block:\n${utils}`,
    );
  }
  const names = alternation[1].split("|").map((entry) => entry.trim());
  if (names.length === 0) {
    throw new Error("banned-source parsed as an empty alternation.");
  }
  return names;
};

describe("given the client/server boundary is guarded by both a lint rule and an import walker", () => {
  describe("when the two ban-lists are compared", () => {
    /** @scenario "The lint rule and the transitive guard ban the same packages" */
    it("bans the same browser-only packages on both sides", () => {
      expect([...readRulePackages()].sort()).toEqual(
        [...readWalkerPackages()].sort(),
      );
    });
  });

  describe("when the TypeScript and Tsx halves of the rule are compared", () => {
    /**
     * `language: TypeScript` does not match `.tsx` in ast-grep's parser
     * dispatch, so the rule has to exist twice. The matching logic is
     * duplicated rather than hoisted into `sgconfig.yml`'s `utilDirs` because
     * CodeRabbit loads these files through `rule_dirs` and never reads
     * `sgconfig.yml` — a shared util would resolve here and break there. This
     * test is what makes that duplication safe.
     */
    it("keeps the matching logic identical between the .ts and .tsx rules", () => {
      expect(readUtilsBlock(RULE_TSX)).toEqual(readUtilsBlock(RULE_TS));
    });
  });

  describe("when the rule files are checked against the test harness", () => {
    /**
     * `ast-grep test` iterates the fixtures in `rule-tests/`, not the rules in
     * `rules/`, so a rule shipped without a fixture is never executed against
     * anything and passes CI in silence. That is exactly how #3754 shipped a
     * dead rule.
     */
    it("proves each half of the rule with a committed fixture", () => {
      for (const rule of [RULE_TS, RULE_TSX]) {
        const id = /^id: (.+)$/m.exec(fs.readFileSync(rule, "utf8"))?.[1];
        expect(id, `${rule} has no id:`).toBeTruthy();

        // House convention: `<name>-ts` is proven by `<name>-test.yml` and
        // `<name>-tsx` by `<name>-tsx-test.yml`. Stripping a trailing `-ts`
        // leaves `-tsx` alone, since it does not end in `-ts`.
        const fixture = path.join(
          REPO_ROOT,
          "dev/lint/ast-grep/rule-tests",
          `${id!.replace(/-ts$/, "")}-test.yml`,
        );

        expect(
          fs.existsSync(fixture),
          `${id} has no fixture at ${fixture} — an unproven rule is a dead rule`,
        ).toBe(true);
      }
    });
  });
});
