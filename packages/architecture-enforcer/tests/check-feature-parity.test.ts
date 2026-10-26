/**
 * @vitest-environment node
 *
 * scripts/check-feature-parity.ts.
 *
 * Two classes of behaviour are pinned here.
 *
 * Binding collection: the proximity check is what decides whether an
 * `@scenario` annotation counts as a binding, so a form it fails to recognise
 * does not error — the annotation is silently dropped and the scenario it was
 * meant to bind is reported unbound. These tests pin the `t.Run` subtest forms
 * that appear in the repo's Go tests, including the multiline one gofmt
 * preserves verbatim.
 *
 * Fail-closed posture: every remaining test here covers a way the check used to
 * pass while measuring nothing — a symlinked invocation that skipped `main()`
 * outright, a renamed spec root that quietly became an empty tree, and a
 * feature file whose scenarios are all untagged. Each of those exited 0.
 */

import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  collectGoBindings,
  discoverFeatureFiles,
  findScenarioAnnotations,
  isFollowedByTestCall,
  formatFailureBanner,
  formatUnknownAnnotations,
  isEntryModule,
  isInert,
  compareFrozenScenarios,
  findAnnotationsOnUntaggedScenarios,
  formatAnnotationsOnUntagged,
  formatFrozenScenarioFailures,
  parseFeatureSource,
} from "../src/tools/check-feature-parity.ts";

let root = "";

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "feature-parity-go-"));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function bindingsFor(goSource: string): string[] {
  writeFileSync(join(root, "probe_test.go"), goSource, "utf8");
  return collectGoBindings([root]).map((b) => b.title);
}

describe("collectGoBindings", () => {
  describe("given a subtest written on one line", () => {
    describe("when the annotation sits directly above it", () => {
      it("collects the binding", () => {
        expect(
          bindingsFor(
            [
              "func TestThing(t *testing.T) {",
              '\t// @scenario "One-line subtest"',
              '\tt.Run("stays on one line", func(t *testing.T) {',
              "\t})",
              "}",
            ].join("\n"),
          ),
        ).toEqual(["One-line subtest"]);
      });
    });
  });

  describe("given a subtest whose call gofmt keeps spread over several lines", () => {
    describe("when the annotation sits directly above it", () => {
      it("collects the binding across the newlines", () => {
        expect(
          bindingsFor(
            [
              "func TestThing(t *testing.T) {",
              '\t// @scenario "Multiline subtest"',
              "\tt.Run(",
              '\t\t"a name long enough that gofmt leaves the call split",',
              "\t\tfunc(t *testing.T) {",
              "\t\t},",
              "\t)",
              "}",
            ].join("\n"),
          ),
        ).toEqual(["Multiline subtest"]);
      });
    });
  });

  describe("given a subtest named by an expression containing a comma", () => {
    describe("when the annotation sits directly above it", () => {
      it("reads past the nested comma to the real argument separator", () => {
        expect(
          bindingsFor(
            [
              "func TestThing(t *testing.T) {",
              '\t// @scenario "Nested comma subtest"',
              '\tt.Run(fmt.Sprintf("%s,%s", tc.a, tc.b), func(t *testing.T) {',
              "\t})",
              "}",
            ].join("\n"),
          ),
        ).toEqual(["Nested comma subtest"]);
      });
    });
  });

  describe("given a top-level test function", () => {
    describe("when the annotation sits directly above it", () => {
      it("collects the binding", () => {
        expect(
          bindingsFor(
            ['/** @scenario "Top-level test func" */', "func TestThing(t *testing.T) {", "}"].join(
              "\n",
            ),
          ),
        ).toEqual(["Top-level test func"]);
      });
    });
  });

  describe("given a Run call that takes no testing closure", () => {
    describe("when an annotation sits above it", () => {
      it("drops the annotation instead of treating it as a subtest", () => {
        expect(
          bindingsFor(
            [
              "func TestThing(t *testing.T) {",
              '\t// @scenario "Not a subtest"',
              "\tserver.Run(ctx)",
              "}",
            ].join("\n"),
          ),
        ).toEqual([]);
      });
    });
  });
});

describe("isEntryModule", () => {
  describe("given the module is invoked through a symlink to itself", () => {
    describe("when the two paths are compared", () => {
      it("recognises the module as the entry point", () => {
        const real = join(root, "check.ts");
        const link = join(root, "check-link.ts");
        writeFileSync(real, "// script", "utf8");
        symlinkSync(real, link);

        // The lexical compare this replaced returned false here, so `main()`
        // never ran and the whole check exited 0 having measured nothing.
        expect(isEntryModule({ invokedPath: link, modulePath: real })).toBe(true);
      });
    });
  });

  describe("given the module is invoked directly", () => {
    describe("when the two paths are the same file", () => {
      it("recognises the module as the entry point", () => {
        const real = join(root, "check.ts");
        writeFileSync(real, "// script", "utf8");

        expect(isEntryModule({ invokedPath: real, modulePath: real })).toBe(true);
      });
    });
  });

  describe("given a different script is the entry point", () => {
    describe("when the two paths are compared", () => {
      it("declines to treat the module as the entry point", () => {
        const real = join(root, "check.ts");
        const other = join(root, "other.ts");
        writeFileSync(real, "// script", "utf8");
        writeFileSync(other, "// other", "utf8");

        expect(isEntryModule({ invokedPath: other, modulePath: real })).toBe(false);
      });
    });
  });

  describe("given the invoked path does not exist on disk", () => {
    describe("when realpath cannot resolve it", () => {
      it("falls back to a lexical mismatch rather than throwing", () => {
        const real = join(root, "check.ts");
        writeFileSync(real, "// script", "utf8");

        expect(
          isEntryModule({
            invokedPath: join(root, "vanished.ts"),
            modulePath: real,
          }),
        ).toBe(false);
      });
    });
  });

  describe("given nothing was passed as argv[1]", () => {
    describe("when the guard runs", () => {
      it("declines to treat the module as the entry point", () => {
        expect(
          isEntryModule({
            invokedPath: undefined,
            modulePath: join(root, "check.ts"),
          }),
        ).toBe(false);
      });
    });
  });
});

describe("discoverFeatureFiles", () => {
  describe("given a configured spec root that no longer exists", () => {
    describe("when the tree is walked", () => {
      it("throws instead of reporting an empty tree", () => {
        // Returning [] here is how a renamed spec directory reports every
        // scenario under it as bound: the files stop being discovered and the
        // check goes green.
        expect(() => discoverFeatureFiles([join(root, "gone")])).toThrow(/does not exist/);
      });
    });
  });

  describe("given a configured spec root that is a file", () => {
    describe("when the tree is walked", () => {
      it("throws instead of reporting an empty tree", () => {
        const notADir = join(root, "specs");
        writeFileSync(notADir, "", "utf8");

        expect(() => discoverFeatureFiles([notADir])).toThrow(/is not a directory/);
      });
    });
  });

  describe("given a configured spec root that holds feature files", () => {
    describe("when the tree is walked", () => {
      it("discovers them", () => {
        const specs = join(root, "specs");
        mkdirSync(specs);
        writeFileSync(join(specs, "a.feature"), "Feature: A\n", "utf8");

        expect(discoverFeatureFiles([specs]).length).toBe(1);
      });
    });
  });
});

describe("isInert", () => {
  describe("given a file whose scenarios are all untagged", () => {
    describe("when the floor is applied", () => {
      it("reports the file as inert", () => {
        // This is the `0/0 scenarios bound · ✓ all bound` trap: twenty
        // scenarios nobody tagged read exactly like a fully-covered file.
        expect(isInert({ scenarios: [], totalScenarios: 20 })).toBe(true);
      });
    });
  });

  describe("given a file with at least one enforced scenario", () => {
    describe("when the floor is applied", () => {
      it("does not report the file as inert", () => {
        expect(
          isInert({
            scenarios: [{ title: "t", tags: ["@unit"], line: 1, bindings: [] }],
            totalScenarios: 20,
          }),
        ).toBe(false);
      });
    });
  });

  describe("given a file that declares no scenarios at all", () => {
    describe("when the floor is applied", () => {
      it("does not report the file as inert", () => {
        // Nothing was claimed, so nothing is being overclaimed.
        expect(isInert({ scenarios: [], totalScenarios: 0 })).toBe(false);
      });
    });
  });
});

describe("findScenarioAnnotations", () => {
  const titles = (src: string): string[] => findScenarioAnnotations(src).map((a) => a.title);

  describe("given the annotation opens no comment of its own", () => {
    // The prefix accepts zero markers so the Python SDK's docstring form keeps
    // binding. Zero markers also matches a bare source line, and only reading
    // the file in order can tell the two apart: the deciding context is on an
    // earlier line.
    it("binds from inside a python docstring, which is how the SDK writes it", () => {
      expect(titles('def test_it():\n    """\n    @scenario Docstring form\n    """\n')).toEqual([
        "Docstring form",
      ]);
    });

    it("binds from inside a block comment that opened on an earlier line", () => {
      expect(titles("/*\n@scenario Marker-less block form\n*/")).toEqual([
        "Marker-less block form",
      ]);
    });

    it("does not bind from a bare source line, which opens nothing", () => {
      expect(titles('@scenario "Bare line"')).toEqual([]);
    });

    it("does not bind from test data, where an annotation is a string not a binding", () => {
      expect(titles('const fixture = `\n@scenario "Quoted in a fixture"\n`;')).toEqual([]);
    });

    it("does not bind after the block comment it was inside has closed", () => {
      expect(titles('/* opened and closed */\n@scenario "After the comment"')).toEqual([]);
    });
  });

  describe("given the annotation opens its comment", () => {
    it("reads a quoted title from a jsdoc block", () => {
      expect(titles('/** @scenario "Quoted title" */')).toEqual(["Quoted title"]);
    });

    it("reads an indented quoted title", () => {
      expect(titles('    /** @scenario "Indented" */')).toEqual(["Indented"]);
    });

    it("reads an unquoted title from a jsdoc continuation line", () => {
      expect(titles(" * @scenario Unquoted continuation")).toEqual(["Unquoted continuation"]);
    });

    it("reads a title from a line comment", () => {
      expect(titles("  // @scenario Line comment form")).toEqual(["Line comment form"]);
    });

    it("reads a title through a continuation that opens a nested block", () => {
      expect(titles("  *   /** @scenario Nested marker */")).toEqual(["Nested marker"]);
    });

    it("reads an unquoted title from a hash comment", () => {
      // Python and Bats tests bind through this form, and their own
      // hash-specific pattern only accepts quoted titles. Drop `#` from the
      // markers this accepts and every unquoted hash binding in the repo goes
      // silently unbound, which the whole-repo run does not surface when the
      // same scenario is also bound from another language.
      expect(titles("# @scenario Unquoted hash form")).toEqual(["Unquoted hash form"]);
    });
  });

  describe("given the comment is open but the line carries no marker", () => {
    it("reads a title from a block comment line with no continuation marker", () => {
      // The marker run is allowed to be empty for this form, and the scanner
      // has no comment state to tell it why: it sees one line at a time, so a
      // line inside an already-open block reaches it with nothing in front of
      // the token. Requiring at least one marker drops this form, and drops it
      // silently, since the annotation simply stops being collected.
      expect(titles("/*\n@scenario No continuation marker\n*/")).toEqual([
        "No continuation marker",
      ]);
    });

    it("reads a title from a python docstring", () => {
      expect(titles('    """\n    @scenario Docstring form\n    """')).toEqual(["Docstring form"]);
    });
  });

  describe("given punctuation that is not a comment marker", () => {
    it("binds nothing behind a lone slash", () => {
      expect(titles("/ @scenario Not a comment")).toEqual([]);
    });

    it("binds nothing behind a marker run that closes rather than opens", () => {
      expect(titles("*/ @scenario Not a comment")).toEqual([]);
    });
  });

  describe("given a line of comment punctuation that never reaches the token", () => {
    it("gives up in linear time instead of backtracking", () => {
      // Each marker in the prefix is a fixed width for this reason. Allowing
      // `/*+` there makes `/**` splittable two ways, so this input has 2^30
      // parses and the engine walks them all: measured at 6.8s for this line
      // alone, against a whole repo of files per run.
      const src = `/${"**/".repeat(30)}x`;
      const started = performance.now();
      expect(titles(src)).toEqual([]);
      expect(performance.now() - started).toBeLessThan(1000);
    });
  });

  describe("given the token appears mid-sentence in prose", () => {
    it("binds nothing when a comment explains that it carries no annotation", () => {
      // The regression this guards: the sentence saying there is no binding
      // was itself parsed as one, and the run then failed naming a scenario
      // nobody wrote, at a line whose comment says the opposite.
      expect(
        titles(
          "// Deliberately carries no @scenario annotation: this guards a temporary\n// exclusion, not a behaviour the spec describes.",
        ),
      ).toEqual([]);
    });

    it("binds nothing when the token is quoted inside prose", () => {
      expect(titles(" * individually via the `@scenario` token in prose")).toEqual([]);
    });

    it("binds nothing when the token trails code on the same line", () => {
      expect(titles("const x = 1; // see @scenario Something for context")).toEqual([]);
    });
  });

  describe("given several annotations in one source", () => {
    it("reports each one with an offset past its own match", () => {
      const src = ['/** @scenario "First" */', '/** @scenario "Second" */'].join("\n");
      const found = findScenarioAnnotations(src);

      expect(found.map((a) => a.title)).toEqual(["First", "Second"]);
      // `end` is what the proximity checks scan forward from, so it has to sit
      // past the match rather than at its start.
      expect(found.every((a) => a.end > a.index)).toBe(true);
      expect(found[1]!.index).toBeGreaterThan(found[0]!.end - 1);
    });
  });
});

describe("formatFailureBanner", () => {
  describe("given the run passes", () => {
    it("prints nothing, so a green run reads exactly as it did before", () => {
      expect(formatFailureBanner([])).toEqual([]);
    });
  });

  describe("given the run fails", () => {
    it("states the verdict before any per-file section is printed", () => {
      const lines = formatFailureBanner(["4 unknown annotation(s)"]);

      expect(lines.join("\n")).toContain("THIS RUN FAILS");
      expect(lines.join("\n")).toContain("4 unknown annotation(s)");
    });

    it("says what a per-file tick does and does not mean", () => {
      // The whole point. Without this the reader sees `✓ all bound` next to
      // their own feature file and concludes the run passed, while the exit
      // code says otherwise.
      expect(formatFailureBanner(["1 unknown annotation(s)"]).join("\n")).toContain(
        "not that the run passed",
      );
    });

    it("carries every reason the exit code was built from", () => {
      const reasons = ["2 unbound scenario(s) in enforced files", "1 unknown annotation(s)"];

      const text = formatFailureBanner(reasons).join("\n");

      for (const reason of reasons) expect(text).toContain(reason);
    });
  });
});

describe("formatUnknownAnnotations", () => {
  const entry = (file: string, title: string, line: number) => ({
    title,
    ref: { file, line },
  });

  describe("given nothing is unknown", () => {
    it("prints nothing", () => {
      expect(formatUnknownAnnotations([])).toEqual([]);
    });
  });

  describe("given unknown annotations across several files", () => {
    it("groups them under the file each was written in", () => {
      const lines = formatUnknownAnnotations([
        entry("b.test.ts", "Second", 20),
        entry("a.test.ts", "First", 10),
        entry("b.test.ts", "Third", 30),
      ]);

      const text = lines.join("\n");
      expect(text).toContain("▸ a.test.ts");
      expect(text).toContain("▸ b.test.ts");
      // One heading per file, not one per annotation.
      expect(lines.filter((l) => l.includes("▸ b.test.ts"))).toHaveLength(1);
    });

    it("orders files so the same input always reports the same way", () => {
      const text = formatUnknownAnnotations([
        entry("z.test.ts", "Last", 1),
        entry("a.test.ts", "First", 1),
      ]).join("\n");

      expect(text.indexOf("a.test.ts")).toBeLessThan(text.indexOf("z.test.ts"));
    });

    it("keeps every annotation and its line", () => {
      const text = formatUnknownAnnotations([
        entry("a.test.ts", "First", 10),
        entry("a.test.ts", "Second", 42),
      ]).join("\n");

      expect(text).toContain("✗ @scenario First");
      expect(text).toContain("line 10");
      expect(text).toContain("✗ @scenario Second");
      expect(text).toContain("line 42");
    });
  });
});

describe("isFollowedByTestCall", () => {
  const afterAnnotation = (src: string): boolean => {
    const [annotation] = findScenarioAnnotations(src);
    if (!annotation) throw new Error("fixture has no annotation");
    return isFollowedByTestCall(src, annotation.end);
  };

  describe("given the annotation sits inside a JSDoc that continues after it", () => {
    /** @scenario "An annotation followed by more of its own JSDoc still binds the test below" */
    it("steps over the continuation lines and the closer to the test call", () => {
      const src = [
        "    /**",
        '     * @scenario "Inside a block"',
        "     *",
        "     * Two lines of prose explaining why this test exists.",
        "     */",
        '    it("does the thing", () => {});',
      ].join("\n");

      expect(afterAnnotation(src)).toBe(true);
    });
  });

  describe("given the annotation is on the closing line", () => {
    /** @scenario "An annotation on the closing line still binds" */
    it("binds exactly as before", () => {
      const src = ['/** @scenario "One line" */', 'it("does the thing", () => {});'].join("\n");

      expect(afterAnnotation(src)).toBe(true);
    });
  });

  describe("given a statement that is not a test call follows the comment", () => {
    /** @scenario "Prose after the comment does not bind" */
    it("binds nothing", () => {
      const src = [
        "    /**",
        '     * @scenario "Inside a block"',
        "     */",
        "    const fixture = 1;",
        '    it("does the thing", () => {});',
      ].join("\n");

      expect(afterAnnotation(src)).toBe(false);
    });
  });
});

describe("compareFrozenScenarios", () => {
  describe("given a file whose older untagged scenario is frozen", () => {
    describe("when a new untagged scenario lands in the same file", () => {
      /** @scenario "A new untagged scenario fails even in a file whose older ones are frozen" */
      it("reports the new one and tolerates the frozen one", () => {
        const { fresh, stale } = compareFrozenScenarios({
          observed: [
            { feature: "specs/a.feature", title: "Old", line: 3 },
            { feature: "specs/a.feature", title: "New", line: 9 },
          ],
          frozen: { "specs/a.feature": ["Old"] },
        });

        expect(fresh).toEqual([{ feature: "specs/a.feature", title: "New", line: 9 }]);
        expect(stale).toEqual([]);
      });
    });

    describe("when the same title appears twice but is frozen once", () => {
      it("reports the second copy", () => {
        const { fresh } = compareFrozenScenarios({
          observed: [
            { feature: "specs/a.feature", title: "Twin", line: 3 },
            { feature: "specs/a.feature", title: "Twin", line: 9 },
          ],
          frozen: { "specs/a.feature": ["Twin"] },
        });

        expect(fresh).toEqual([{ feature: "specs/a.feature", title: "Twin", line: 9 }]);
      });
    });
  });

  describe("given a frozen scenario that has since been tagged", () => {
    describe("when the gate compares", () => {
      /** @scenario "A frozen scenario that no longer breaks the rule must leave the list" */
      it("reports the entry as stale", () => {
        const { fresh, stale } = compareFrozenScenarios({
          observed: [],
          frozen: { "specs/a.feature": ["Now tagged"] },
        });

        expect(fresh).toEqual([]);
        expect(stale).toEqual([{ feature: "specs/a.feature", title: "Now tagged" }]);
      });
    });
  });
});

describe("findAnnotationsOnUntaggedScenarios", () => {
  const binding = (file: string, title: string) => ({ title, ref: { file, line: 12 } });
  const scenario = (title: string, tags: string[]) => ({
    feature: "specs/a.feature",
    scenario: { title, tags, line: 7 },
  });

  describe("given an integration test bound to a scenario tagged only @bdd", () => {
    describe("when the gate looks for annotations on untagged scenarios", () => {
      /** @scenario "An annotation on a scenario with no binding tag fails, naming the scenario and the missing tag" */
      it("names the test, the scenario and the missing tag", () => {
        const found = findAnnotationsOnUntaggedScenarios({
          bindings: [binding("modules/x/__tests__/y.integration.test.ts", "Prose only")],
          scenarios: [scenario("Prose only", ["@bdd"])],
        });

        expect(found).toEqual([
          {
            title: "Prose only",
            ref: { file: "modules/x/__tests__/y.integration.test.ts", line: 12 },
            scenario: { feature: "specs/a.feature", title: "Prose only", line: 7 },
            missingTag: "@integration",
            parked: false,
          },
        ]);

        const text = formatAnnotationsOnUntagged(found).join("\n");

        expect(text).toContain(
          'modules/x/__tests__/y.integration.test.ts:12 @scenario "Prose only"',
        );
        expect(text).toContain("binds specs/a.feature:7, which is missing @integration");
      });
    });
  });

  describe("given a unit test bound to an @unimplemented scenario", () => {
    describe("when the gate formats the finding", () => {
      /** @scenario "An annotation on an @unimplemented scenario says to replace the tag" */
      it("tells the author to replace @unimplemented with the lane tag", () => {
        const found = findAnnotationsOnUntaggedScenarios({
          bindings: [binding("modules/x/y.unit.test.ts", "Parked")],
          scenarios: [scenario("Parked", ["@unimplemented"])],
        });

        expect(formatAnnotationsOnUntagged(found).join("\n")).toContain(
          "Replace @unimplemented with @unit",
        );
      });
    });
  });

  describe("given a test bound to a scenario tagged @unit", () => {
    describe("when the gate looks for annotations on untagged scenarios", () => {
      /** @scenario "An annotation on a tagged scenario is not reported" */
      it("reports nothing", () => {
        expect(
          findAnnotationsOnUntaggedScenarios({
            bindings: [binding("modules/x/y.unit.test.ts", "Tagged")],
            scenarios: [scenario("Tagged", ["@unit"])],
          }),
        ).toEqual([]);
      });
    });
  });
});

describe("parseFeatureSource", () => {
  describe("given @unimplemented scenarios citing issues in each accepted form", () => {
    describe("when the gate reads the feature file", () => {
      /** @scenario "An @unimplemented scenario cites its issue by tag or by the comment directly above" */
      it("credits the tag and the adjacent comment, not a comment a blank line away", () => {
        const scenarios = parseFeatureSource(
          [
            "Feature: F",
            "",
            "  @unit @unimplemented @issue:1234",
            "  Scenario: By tag",
            "    Given x",
            "",
            "  # Tracked by #1234.",
            "  @unit @unimplemented",
            "  Scenario: By comment",
            "    Given x",
            "",
            "  # Tracked by #1234.",
            "",
            "  @unit @unimplemented",
            "  Scenario: Comment too far",
            "    Given x",
          ].join("\n"),
        );

        expect(scenarios.map((s) => [s.title, s.citesIssue])).toEqual([
          ["By tag", true],
          ["By comment", true],
          ["Comment too far", false],
        ]);

        const featureTagged = parseFeatureSource(
          ["@issue:1234", "Feature: F", "  @unimplemented", "  Scenario: Inherited"].join("\n"),
        );

        expect(featureTagged[0]?.citesIssue).toBe(true);
      });
    });
  });
});

describe("formatFrozenScenarioFailures", () => {
  describe("given one finding of each kind", () => {
    describe("when the gate formats its findings", () => {
      /** @scenario "Every parity finding says what to do instead" */
      it("tells each one what to do instead", () => {
        const text = formatFrozenScenarioFailures({
          untagged: {
            fresh: [{ feature: "specs/a.feature", title: "Bare", line: 4 }],
            stale: [{ feature: "specs/a.feature", title: "Gone" }],
          },
          unimplementedWithoutIssue: {
            fresh: [{ feature: "specs/b.feature", title: "Parked", line: 8 }],
            stale: [],
          },
        }).join("\n");

        expect(text).toContain('specs/a.feature:4 "Bare"');
        expect(text).toContain("Tag it @unit / @integration / @e2e / @regression and bind a test");
        expect(text).toContain("tag it @unimplemented with an @issue:<number> tag, or delete it");
        expect(text).toContain('specs/b.feature:8 "Parked"');
        expect(text).toContain(
          "Add an @issue:<number> tag to it, or a comment line directly above its tags naming #<number>.",
        );
        expect(text).toContain(
          'remove them from "untagged" in packages/architecture-enforcer/src/tools/feature-parity-frozen.json',
        );
        expect(text).toContain('specs/a.feature "Gone"');
      });
    });
  });
});
