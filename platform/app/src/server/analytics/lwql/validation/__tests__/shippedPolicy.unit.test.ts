/**
 * Guards on what the LangWatchQL API *ships*, as opposed to what it computes.
 *
 * Two scope commitments from #6480 that nothing else can hold: the API stays
 * native ClickHouse SQL parsed by ClickHouse's own grammar (no query language,
 * compiler or IR of ours, and no BI platform underneath it), and the
 * table-function policy is written down where the next person will look for it
 * rather than living only in a code comment.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

/** `…/validation/__tests__` → `platform/app/` */
const APP_ROOT = fileURLToPath(new URL("../../../../../../", import.meta.url));
/** `platform/app/` → repository root */
const REPO_ROOT = join(APP_ROOT, "..", "..");
const ADR_ROOT = join(REPO_ROOT, "dev", "docs", "adr");
const LWQL_ROOT = join(APP_ROOT, "src", "server", "analytics", "lwql");

/**
 * Packages that would mean a BI platform, a query engine, or a semantic layer
 * had been taken on. #6480 reversed an earlier direction (#6346, #5670) that
 * would have built one; the point of listing them is that the reversal is
 * enforced rather than remembered.
 */
const BI_PLATFORM_PATTERN =
  /(^|[/@-])(cube|cubejs|trino|presto|superset|metabase|looker|malloy)([/-]|$)/i;

/** File extensions that only exist because someone wrote a grammar. */
const GRAMMAR_EXTENSIONS = [
  ".pegjs",
  ".peg",
  ".g4",
  ".jison",
  ".ne",
  ".ohm",
  ".grammar",
  ".lark",
];

/** Module names that would mean we had built a front end of our own. */
const OWN_FRONT_END_PATTERN = /(grammar|lexer|tokeni[sz]|compiler|codegen|\bir\b)/i;

/**
 * The ADR that owns the table-function and SSRF policy.
 *
 * Named rather than discovered by text search: ownership is a decision, and a
 * search finds whichever ADR happens to mention both terms. Anchoring it here
 * means an ADR-081 that stopped documenting the policy fails as exactly that,
 * rather than as a corpus-wide count nobody can read.
 */
const POLICY_ADR = "081-lwql-table-function-and-ssrf-policy.md";

/**
 * Both spellings, because the ADR uses both: hyphenated in its filename and in
 * compound adjectives, spaced in ordinary prose. A pattern that accepted only
 * one made ownership depend on which sentence the author happened to write.
 */
const TABLE_FUNCTION_PATTERN = /table[\s-]function/i;

function readManifest(): {
  dependencies: Record<string, string>;
  all: string[];
} {
  const manifest = JSON.parse(readFileSync(join(APP_ROOT, "package.json"), "utf8")) as {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };
  const dependencies = manifest.dependencies ?? {};
  return {
    dependencies,
    all: Object.keys({ ...dependencies, ...(manifest.devDependencies ?? {}) }),
  };
}

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules") continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) walk(path, out);
    else out.push(path);
  }
  return out;
}

describe("what the LangWatchQL API ships", () => {
  describe("given the application's dependency manifest and source tree", () => {
    /** @scenario "No custom query language and no new BI platform dependency ships" */
    it("carries no BI platform, query engine, or semantic-layer dependency", () => {
      const offenders = readManifest().all.filter((name) =>
        BI_PLATFORM_PATTERN.test(name),
      );

      expect(
        offenders,
        "#6480 settled on native ClickHouse SQL rather than a BI platform",
      ).toEqual([]);
    });

    it("holds no grammar of its own anywhere in the application source", () => {
      const grammars = walk(join(APP_ROOT, "src")).filter((path) =>
        GRAMMAR_EXTENSIONS.some((extension) => path.endsWith(extension)),
      );

      expect(grammars).toEqual([]);
    });

    it("builds no parser, compiler, or intermediate representation of its own", () => {
      const homegrown = walk(LWQL_ROOT).filter((path) =>
        OWN_FRONT_END_PATTERN.test(path.slice(LWQL_ROOT.length)),
      );

      expect(
        homegrown,
        "the SQL front end is delegated; a module named for one here means it stopped being",
      ).toEqual([]);
    });

    it("delegates parsing to ClickHouse's own parser, pinned to an exact version", () => {
      const { dependencies } = readManifest();
      const pin = dependencies["@clickhouse/parser"];

      expect(pin, "@clickhouse/parser must be a direct dependency").toBeDefined();
      expect(
        pin,
        "a 0.x parser whose AST is the validator's security contract is pinned, not ranged",
      ).toMatch(/^\d+\.\d+\.\d+$/);
      expect(readFileSync(join(LWQL_ROOT, "validation", "parser.ts"), "utf8")).toContain(
        'from "@clickhouse/parser"',
      );
    });
  });

  describe("given the repository's ADR index", () => {
    /** @scenario "The table-function and SSRF policy is captured as an ADR" */
    it("documents why user-supplied table functions stay blocked by AST and by grants", () => {
      const adrs = readdirSync(ADR_ROOT)
        .filter((name) => /^\d{3}-.*\.md$/.test(name))
        .map((name) => ({
          name,
          text: readFileSync(join(ADR_ROOT, name), "utf8"),
        }));

      // Ownership first, keyed on the filename, so a policy that stopped being
      // documented fails as "ADR-081 no longer covers it" rather than as a
      // count over every ADR in the repository.
      const policy = adrs.find(({ name }) => name === POLICY_ADR);
      expect(
        policy,
        `${POLICY_ADR} owns the table-function and SSRF policy and is not in ${ADR_ROOT}`,
      ).toBeDefined();
      if (!policy) throw new Error("unreachable: presence asserted above");

      expect(
        policy.text,
        `${POLICY_ADR} no longer documents the table-function policy`,
      ).toMatch(TABLE_FUNCTION_PATTERN);
      expect(policy.text, `${POLICY_ADR} no longer documents the SSRF policy`).toMatch(
        /SSRF/i,
      );

      // Both mechanisms, because the ADR's job is to stop either one being
      // mistaken for the whole boundary.
      expect(policy.text, "names the AST half").toMatch(/AST/);
      expect(policy.text, "names the grants half").toMatch(/grant/i);

      // Uniqueness second, and it means something different: a reader who
      // follows the index must land on one answer, not two that could diverge.
      //
      // Read off the *filename*, not the body. A body search cannot tell an ADR
      // that owns the policy from one that cites it, and the sibling LangWatchQL
      // ADRs legitimately cite it — 082 and 084 both name table functions and
      // SSRF while deciding something else entirely. An ADR *titled* for the
      // policy is the ambiguity worth failing on.
      expect(
        adrs
          .filter(({ name }) => TABLE_FUNCTION_PATTERN.test(name) && /ssrf/i.test(name))
          .map(({ name }) => name),
        "a second ADR is named for the table-function and SSRF policy, so which one governs is ambiguous",
      ).toEqual([POLICY_ADR]);

      expect(
        readFileSync(join(ADR_ROOT, "README.md"), "utf8"),
        "an ADR nobody can find from the index is not captured",
      ).toContain(policy.name);
    });
  });
});
