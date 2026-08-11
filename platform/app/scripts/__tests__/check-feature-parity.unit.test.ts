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

import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  collectGoBindings,
  discoverFeatureFiles,
  findScenarioAnnotations,
  formatFailureBanner,
  formatUnknownAnnotations,
  isEntryModule,
  isInert,
} from "../check-feature-parity";

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
            [
              '/** @scenario "Top-level test func" */',
              "func TestThing(t *testing.T) {",
              "}",
            ].join("\n"),
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
        expect(isEntryModule({ invokedPath: link, modulePath: real })).toBe(
          true,
        );
      });
    });
  });

  describe("given the module is invoked directly", () => {
    describe("when the two paths are the same file", () => {
      it("recognises the module as the entry point", () => {
        const real = join(root, "check.ts");
        writeFileSync(real, "// script", "utf8");

        expect(isEntryModule({ invokedPath: real, modulePath: real })).toBe(
          true,
        );
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

        expect(isEntryModule({ invokedPath: other, modulePath: real })).toBe(
          false,
        );
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
        expect(() => discoverFeatureFiles([join(root, "gone")])).toThrow(
          /does not exist/,
        );
      });
    });
  });

  describe("given a configured spec root that is a file", () => {
    describe("when the tree is walked", () => {
      it("throws instead of reporting an empty tree", () => {
        const notADir = join(root, "specs");
        writeFileSync(notADir, "", "utf8");

        expect(() => discoverFeatureFiles([notADir])).toThrow(
          /is not a directory/,
        );
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
  const titles = (src: string): string[] =>
    findScenarioAnnotations(src).map((a) => a.title);

  describe("given the annotation opens its comment", () => {
    it("reads a quoted title from a jsdoc block", () => {
      expect(titles('/** @scenario "Quoted title" */')).toEqual([
        "Quoted title",
      ]);
    });

    it("reads an indented quoted title", () => {
      expect(titles('    /** @scenario "Indented" */')).toEqual(["Indented"]);
    });

    it("reads an unquoted title from a jsdoc continuation line", () => {
      expect(titles(" * @scenario Unquoted continuation")).toEqual([
        "Unquoted continuation",
      ]);
    });

    it("reads a title from a line comment", () => {
      expect(titles("  // @scenario Line comment form")).toEqual([
        "Line comment form",
      ]);
    });

    it("reads a title through a continuation that opens a nested block", () => {
      expect(titles("  *   /** @scenario Nested marker */")).toEqual([
        "Nested marker",
      ]);
    });

    it("reads an unquoted title from a hash comment", () => {
      // Python and Bats tests bind through this form, and their own
      // hash-specific pattern only accepts quoted titles. Drop `#` from the
      // markers this accepts and every unquoted hash binding in the repo goes
      // silently unbound, which the whole-repo run does not surface when the
      // same scenario is also bound from another language.
      expect(titles("# @scenario Unquoted hash form")).toEqual([
        "Unquoted hash form",
      ]);
    });
  });

  describe("given a line of comment punctuation that never reaches the token", () => {
    it("gives up in linear time instead of backtracking", () => {
      // The prefix has to accept `//`, `/**` and a bare `*`. Spelling that as
      // an alternation under a repeat makes `/**` splittable two ways, so this
      // input has 2^30 parses and the engine walks them all: measured at 7s
      // for this line alone, against a whole repo of files per run.
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
      expect(
        titles(" * individually via the `@scenario` token in prose"),
      ).toEqual([]);
    });

    it("binds nothing when the token trails code on the same line", () => {
      expect(
        titles("const x = 1; // see @scenario Something for context"),
      ).toEqual([]);
    });
  });

  describe("given several annotations in one source", () => {
    it("reports each one with an offset past its own match", () => {
      const src = [
        '/** @scenario "First" */',
        '/** @scenario "Second" */',
      ].join("\n");
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
      expect(
        formatFailureBanner(["1 unknown annotation(s)"]).join("\n"),
      ).toContain("not that the run passed");
    });

    it("carries every reason the exit code was built from", () => {
      const reasons = [
        "2 unbound scenario(s) in enforced files",
        "1 unknown annotation(s)",
      ];

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
