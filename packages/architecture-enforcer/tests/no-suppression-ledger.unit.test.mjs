import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

// specs/tooling/lint-baseline.feature: the suppression ledger is gone, and a rule
// either runs everywhere or is turned off by name where a reader can see it.

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const root = resolve(packageRoot, "../..");

const ARCHITECTURE_CONFIG = join(packageRoot, "oxlint.architecture.jsonc");
const architecture = readFileSync(ARCHITECTURE_CONFIG, "utf8");

/**
 * The config that can turn a rule off. `dev/lint/oxlint.baseline.jsonc` used
 * to be a second one, read the same way; it is now deleted outright rather
 * than thinned, so it is checked absent below instead of read here.
 */
const CONFIGS = [["oxlint.architecture.jsonc", architecture]];

/** Where the deleted per-file override config used to live. */
const DELETED_OVERRIDE_CONFIG = join(root, "dev/lint/oxlint.baseline.jsonc");

/**
 * How a suppression list that defers debt describes itself, matched only against
 * the comment on a block that turns a rule off for named files.
 */
const DEFERRAL =
  /debt register|shrink-only|may only shrink|can only shrink|seeded into the|held here rather than/i;

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
      expect(existsSync(DELETED_OVERRIDE_CONFIG)).toBe(false);
    });
  });

  describe("when every rule is read for a per-file excuse", () => {
    /** @scenario "A rule reports every finding, in every file" */
    it("finds no rule consulting a baseline before it reports", () => {
      const consulting = readdirSync(RULE_SOURCES)
        .filter((entry) => entry.endsWith(".mjs"))
        .filter((entry) => {
          const source = readFileSync(join(RULE_SOURCES, entry), "utf8");

          return /isBaselined|baselineKey|loadBaseline|oxlint-baseline/.test(source);
        });

      expect(consulting).toEqual([]);
    });
  });

  describe("when the oxlint configuration is read for a deferred-debt block", () => {
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

  describe("when the override blocks are read", () => {
    /** @scenario "No langwatch rule is turned off for a path" */
    it("switches no langwatch rule off for any path", () => {
      // Inverted on 2026-09-17. This once asserted that turning a rule off was
      // allowed so long as the block named a category rather than a file list.
      // There is no exempt category any more: a rule is `error` for the whole
      // tree, so an override may raise a ceiling or enable a rule for a path,
      // and may never switch one off.
      expect(architecture.match(/"langwatch\/[a-z-]+":\s*"off"/g) ?? []).toEqual([]);

      // A `files` glob still has to name a CATEGORY. A path to one source file
      // would be the ledger growing back by hand, whatever it set.
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
    /** @scenario "The readability and stand-in tiers are enforced in tests too" */
    it("leaves each one an error, with no block relaxing it for tests", () => {
      for (const rule of [
        "stand-in-cast",
        "condition-shape",
        "comment-block-size",
        "cognitive-complexity",
        "no-inline-dynamic-import",
      ]) {
        expect(testTier).not.toMatch(new RegExp(`"langwatch/${rule}":\\s*"off"`));
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
