import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// specs/tooling/lint-baseline.feature
//
// The ledger these guards refuse held 6,925 `rule|file` rows hiding 8,904
// findings, and its reader was a bare set lookup - so a listed file was exempt
// from that rule however many NEW violations it gained. It is gone. What is
// left is the property that made deleting it worth the 9,000-finding jump:
// a rule now either runs everywhere, or is turned off by name where a reader
// can see it.

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const root = resolve(packageRoot, "../..");

const ARCHITECTURE_CONFIG = join(packageRoot, "oxlint.architecture.jsonc");
const architecture = readFileSync(ARCHITECTURE_CONFIG, "utf8");

/** Where the deleted ledger and its reader lived. */
const LEDGER = join(packageRoot, "src/oxlint-baseline.json");
const LEDGER_READER = join(root, "packages/oxlint-rules/src/baseline.mjs");

const RULE_SOURCES = join(root, "packages/oxlint-rules/src/rules");

describe("given the repository as it stands", () => {
  describe("when the oxlint baseline path is looked for", () => {
    /** @scenario "There is no suppression ledger to read" */
    it("finds neither the ledger nor the reader the rules used to consult", () => {
      expect(existsSync(LEDGER)).toBe(false);
      expect(existsSync(LEDGER_READER)).toBe(false);
    });
  });

  describe("when every rule is read for a per-file excuse", () => {
    /** @scenario "A rule reports every finding, in every file" */
    it("finds no rule consulting a baseline before it reports", () => {
      const consulting = readdirSync(RULE_SOURCES)
        .filter((entry) => entry.endsWith(".rule.mjs"))
        .filter((entry) => {
          const source = readFileSync(join(RULE_SOURCES, entry), "utf8");

          return /isBaselined|baselineKey|loadBaseline|oxlint-baseline/.test(source);
        });

      expect(consulting).toEqual([]);
    });
  });

  describe("when a rule the repository does not enforce is turned off", () => {
    /** @scenario "Turning a rule off is a visible configuration choice" */
    it("names the rule in the configuration and never a list of individual files", () => {
      const offByName = architecture.match(/"langwatch\/[a-z-]+":\s*"off"/g) ?? [];
      expect(offByName.length).toBeGreaterThan(0);

      // A `files` glob names a CATEGORY - tests, published packages, .tsx.
      // A path to one source file would be the ledger growing back by hand.
      const globs = [...architecture.matchAll(/"files":\s*\[([^\]]*)\]/g)]
        .flatMap((match) => match[1].match(/"([^"]+)"/g) ?? [])
        .map((glob) => glob.slice(1, -1));

      expect(globs.length).toBeGreaterThan(0);
      expect(globs.filter((glob) => !glob.includes("*"))).toEqual([]);
    });
  });
});

describe("given the test-file tier", () => {
  /** The override block keyed by the test categories, as raw text. */
  const testTier = architecture.slice(architecture.indexOf('"**/__tests__/**"'));

  describe("when the readability and stand-in rules run over a test", () => {
    /** @scenario "The readability and stand-in tiers are relaxed for tests" */
    it("relaxes each of them, while the workspace-wide setting stays an error", () => {
      for (const rule of [
        "stand-in-cast",
        "condition-shape",
        "comment-block-size",
        "cognitive-complexity",
        "empty-catch",
        "no-inline-dynamic-import",
      ]) {
        expect(testTier).toMatch(new RegExp(`"langwatch/${rule}":\\s*"off"`));
        expect(architecture).toMatch(new RegExp(`"langwatch/${rule}":\\s*(?:"error"|\\["error")`));
      }
    });
  });

  describe("when a rule written for tests runs over a test", () => {
    /** @scenario "The rules written for tests stay enforced in tests" */
    it("leaves each one enforced, because relaxing it would delete the rule", () => {
      for (const rule of [
        "test-description-is-an-action",
        "shared-setup-is-a-hook",
        "banned-test-model-names",
        "unit-test-does-not-render",
      ]) {
        expect(testTier).not.toMatch(new RegExp(`"langwatch/${rule}":\\s*"off"`));
      }
    });
  });
});
