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
  collectMalformedJsdocAnnotations,
  discoverFeatureFiles,
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

describe("collectMalformedJsdocAnnotations", () => {
  it("reports a scenario tag embedded in a multi-line JSDoc block", () => {
    const tests = join(root, "tests");
    mkdirSync(tests);
    writeFileSync(
      join(tests, "parity.test.ts"),
      [
        "/**",
        " * Explains the case.",
        ' * @scenario "A scenario in a JSDoc body"',
        " */",
        'it("covers the case", () => {});',
      ].join("\n"),
      "utf8",
    );

    expect(collectMalformedJsdocAnnotations({ testRoots: [tests] })).toEqual([
      expect.objectContaining({
        title: "A scenario in a JSDoc body",
        ref: expect.objectContaining({
          file: expect.stringContaining("parity.test.ts"),
          line: 3,
        }),
        reason: expect.stringContaining("put it on its own annotation line"),
      }),
    ]);
  });

  it("reports an unquoted scenario tag embedded in a multi-line JSDoc block", () => {
    const tests = join(root, "tests");
    mkdirSync(tests);
    writeFileSync(
      join(tests, "parity.test.ts"),
      [
        "/**",
        " * @scenario A bare scenario title",
        " */",
        'it("covers the case", () => {});',
      ].join("\n"),
      "utf8",
    );

    expect(collectMalformedJsdocAnnotations({ testRoots: [tests] })).toEqual([
      expect.objectContaining({
        title: "A bare scenario title",
        ref: expect.objectContaining({ line: 2 }),
      }),
    ]);
  });

  it("ignores JSDoc examples inside template strings", () => {
    const tests = join(root, "tests");
    mkdirSync(tests);
    writeFileSync(
      join(tests, "parity.test.ts"),
      [
        "const example = `/**",
        " * @scenario \\\"not a real annotation\\\"",
        " */`;",
        'it("covers the case", () => {});',
      ].join("\n"),
      "utf8",
    );

    expect(collectMalformedJsdocAnnotations({ testRoots: [tests] })).toEqual([]);
  });

  it("does not report the supported single-line JSDoc form", () => {
    const tests = join(root, "tests");
    mkdirSync(tests);
    writeFileSync(
      join(tests, "parity.test.ts"),
      '/** @scenario "A supported annotation" */\nit("covers the case", () => {});',
      "utf8",
    );

    expect(collectMalformedJsdocAnnotations({ testRoots: [tests] })).toEqual([]);
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
