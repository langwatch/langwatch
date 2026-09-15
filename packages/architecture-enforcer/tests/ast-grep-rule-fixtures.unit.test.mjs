import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { load as loadYaml } from "js-yaml";
import { describe, expect, it } from "vitest";

// The fixture gate for the ast-grep rules (ADR-135). CI's `ast-grep test`
// proves a rule still matches the fixture it has; it cannot notice a rule
// with none, which is how `no-form-watch-in-child` once matched nothing
// unnoticed. This pairs both directories by id.

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const RULES = join(root, "dev/lint/ast-grep/rules");
const FIXTURES = join(root, "dev/lint/ast-grep/rule-tests");

function load(dir) {
  return readdirSync(dir)
    .filter((name) => name.endsWith(".yml"))
    .map((name) => ({ name, document: loadYaml(readFileSync(join(dir, name), "utf8")) }));
}

const rules = load(RULES);
const fixtures = load(FIXTURES);
const fixtureById = new Map(fixtures.map((entry) => [entry.document.id, entry.document]));

/** The ts and tsx halves of one rule, which carry the same message. */
function declarationsOf(base) {
  return rules.filter(({ document }) => document.id.replace(/-tsx?$/, "") === base);
}

/**
 * One rule keeps a message and, for each of its ts/tsx halves, a fixture with
 * at least one refused and one accepted case.
 */
function expectFixturePins(base, phrase) {
  const declared = declarationsOf(base);
  expect(declared.length).toBeGreaterThan(0);

  for (const { document } of declared) {
    const fixture = fixtureById.get(document.id);

    expect(fixture, `${document.id} has no fixture`).toBeDefined();
    expect(fixture.invalid?.length ?? 0, `${document.id} pins no refused case`).toBeGreaterThan(0);
    expect(fixture.valid?.length ?? 0, `${document.id} pins no accepted case`).toBeGreaterThan(0);
    expect(document.message).toContain(phrase);
  }
}

describe("given the committed ast-grep rules and fixtures", () => {
  describe("when the gate pairs them by id", () => {
    /** @scenario "Every ast-grep rule has a fixture with a refused and an accepted case" */
    it("finds a fixture holding both cases for every rule", () => {
      const unpinned = rules
        .filter(({ document }) => {
          const fixture = fixtureById.get(document.id);
          return !fixture || !fixture.invalid?.length || !fixture.valid?.length;
        })
        .map(({ document }) => document.id);

      expect(unpinned).toEqual([]);
    });

    /** @scenario "A fixture naming no rule is reported" */
    it("finds a declared rule behind every fixture", () => {
      const declared = new Set(rules.map(({ document }) => document.id));
      const orphans = fixtures
        .filter(({ document }) => !declared.has(document.id))
        .map(({ name }) => name);

      expect(orphans).toEqual([]);
    });
  });

  describe("when the gate reads the test-shape rules", () => {
    /** @scenario "The tautological assertion rule keeps a fixture and says the assertion cannot fail" */
    it("pins no-tautological-assertion", () => {
      expectFixturePins("no-tautological-assertion", "cannot fail");
    });

    /** @scenario "The action-based name rule keeps a fixture and names the word it refuses" */
    it("pins use-action-based-test-name", () => {
      expectFixturePins("use-action-based-test-name", "should");
    });

    /** @scenario "The describe context rule keeps a fixture and names the given form" */
    it("pins require-bdd-describe-context", () => {
      expectFixturePins("require-bdd-describe-context", "given");
    });

    /** @scenario "The form watch rule keeps a fixture and names the call it refuses" */
    it("pins no-form-watch-in-child", () => {
      expectFixturePins("no-form-watch-in-child", "form.watch()");
    });

    /** @scenario "The submit disable rule keeps a fixture and names the in-flight shape" */
    it("pins no-form-disable-on-isvalid", () => {
      expectFixturePins("no-form-disable-on-isvalid", "isPending");
    });
  });

  describe("when the gate reads the platform-invariant rules", () => {
    /** @scenario "The dynamic import rule keeps a fixture and offers the top-level import" */
    it("pins no-inline-dynamic-import", () => {
      expectFixturePins("no-inline-dynamic-import", "top-level");
    });

    /** @scenario "The localhost fallback rule keeps a fixture and names the env schema" */
    it("pins no-localhost-fallback", () => {
      expectFixturePins("no-localhost-fallback", "Zod env schema");
    });

    /** @scenario "The fetch timeout rule keeps a fixture and names the signal to pass" */
    it("pins require-fetch-timeout", () => {
      expectFixturePins("require-fetch-timeout", "AbortSignal.timeout");
    });

    /** @scenario "The re-export rule keeps a fixture and says to update the consumers" */
    it("pins no-export-star-shim", () => {
      expectFixturePins("no-export-star-shim", "re-export shim");
    });

    /** @scenario "The double assertion rule keeps a fixture and names the shape it refuses" */
    it("pins no-double-type-assertion", () => {
      expectFixturePins("no-double-type-assertion", "as unknown as");
    });

    /** @scenario "The skip guard rule keeps a fixture and says what the inversion means" */
    it("pins no-clickhouse-env-skip-guard", () => {
      expectFixturePins("no-clickhouse-env-skip-guard", "always skip");
    });
  });

  describe("when the gate reads the naming rules", () => {
    /** @scenario "The boolean prefix rule keeps a fixture and names the prefixes it accepts" */
    it("pins require-boolean-name-prefix", () => {
      expectFixturePins("require-boolean-name-prefix", "prefix");
    });

    /** @scenario "The identity function rule keeps a fixture and says it adds no behaviour" */
    it("pins no-identity-function", () => {
      expectFixturePins("no-identity-function", "identity function");
    });
  });
});
