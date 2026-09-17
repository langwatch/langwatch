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

/** Both files that can turn a rule off, so a register cannot move between them. */
const CONFIGS = [
  ["oxlint.architecture.jsonc", architecture],
  ["dev/lint/oxlint.baseline.jsonc", readFileSync(join(root, "dev/lint/oxlint.baseline.jsonc"), "utf8")],
];

/**
 * The vocabulary a suppression list uses about itself. An exception that is
 * part of the design says what the exempt files ARE; a register says the
 * exemption is temporary and names the debt it defers. The block this guard
 * was written after called itself a DEBT REGISTER in its own header and
 * promised it "can only shrink", while listing one path twice.
 *
 * This is matched only against the comment attached to a block that turns a
 * rule off for named files. Prose elsewhere in a config is free to describe
 * the ledger's history -- and does.
 */
const DEFERRAL = /debt register|shrink-only|may only shrink|can only shrink|seeded into the|held here rather than/i;

/** Each `{ "files": [...], "rules": {...} }` block with the comment above it. */
function overrideBlocks(source) {
  const blocks = [];
  for (const match of source.matchAll(/"files":\s*\[([^\]]*)\]([\s\S]{0,400}?)\}/g)) {
    const before = source.slice(Math.max(0, match.index - 900), match.index);
    const comment = before.slice(before.lastIndexOf("},") + 1);
    blocks.push({
      paths: (match[1].match(/"([^"]+)"/g) ?? []).map((glob) => glob.slice(1, -1)),
      rules: match[2],
      comment,
    });
  }
  return blocks;
}

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

  describe("when either oxlint configuration is read for a deferred-debt block", () => {
    /** @scenario "No configuration block defers debt by naming files" */
    it("finds no rule switched off for named files by a comment calling it temporary", () => {
      const offenders = CONFIGS.flatMap(([name, source]) =>
        overrideBlocks(source)
          // An exact path names a FILE, which is what a register does. A glob
          // names a category -- tests, published packages, .tsx -- which is
          // the legitimate form and stays allowed however it is described.
          .filter((block) => block.paths.some((glob) => !glob.includes("*")))
          .filter((block) => /"off"/.test(block.rules))
          .filter((block) => DEFERRAL.test(block.comment))
          .map((block) => `${name}: ${block.paths[0]}`),
      );

      expect(offenders).toEqual([]);
    });
  });

  describe("when the register this guard was written after is fed back in", () => {
    /** @scenario "The deferred-debt check reports a register rather than passing it" */
    it("reports it, which is what makes a clean run mean anything", () => {
      // Verbatim shape of the block removed from oxlint.architecture.jsonc,
      // down to api-transport.ts appearing twice.
      const register = `
    // ------------------------------------------------------------------
    // DEBT REGISTER, langwatch/boolean-wall, packages/architecture-enforcer/src
    // only. Measured 2026-09-06: 48 boolean walls over 9 files. Splitting
    // each into named intermediate predicates is real refactoring, not a
    // rename, so the 9 files are held here rather than switched off
    // package-wide. The register can only shrink: name a predicate and
    // delete the file's line.
    // ------------------------------------------------------------------
    {
      "files": [
        "packages/architecture-enforcer/src/policies/api-transport.ts",
        "packages/architecture-enforcer/src/policies/global-app-access.ts",
        "packages/architecture-enforcer/src/policies/api-transport.ts"
      ],
      "rules": { "langwatch/boolean-wall": "off" }
    },`;

      const caught = overrideBlocks(register)
        .filter((entry) => entry.paths.some((glob) => !glob.includes("*")))
        .filter((entry) => /"off"/.test(entry.rules))
        .filter((entry) => DEFERRAL.test(entry.comment));

      expect(caught).toHaveLength(1);
      expect(caught[0].paths).toContain(
        "packages/architecture-enforcer/src/policies/global-app-access.ts",
      );
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
