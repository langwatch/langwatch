/**
 * @vitest-environment node
 *
 * scripts/check-feature-parity.ts.
 *
 * Two classes of behaviour are pinned here.
 *
 * Binding collection: the proximity check is what decides whether an
 * '@scenario' annotation counts as a binding, so a form it fails to recognise
 * does not error — the annotation is silently dropped and the scenario it was
 * meant to bind is reported unbound. These tests pin the `t.Run` subtest forms
 * that appear in the repo's Go tests, including the multiline one gofmt
 * preserves verbatim.
 *
 * Fail-closed posture: every remaining test here covers a way the check used to
 * pass while measuring nothing — a symlinked invocation that skipped `main()`
 * outright, a renamed spec root that quietly became an empty tree, a feature
 * file whose scenarios are all untagged, a file where ONE tagged scenario
 * laundered every untagged sibling into invisibility, and a scenario parked
 * with a private word (`@deferred`) the checker never counted. Each of those
 * exited 0.
 *
 * The accounting cases below are driven from real Gherkin text rather than
 * hand-built report objects, because the tags on the page are the only input
 * that decides which bucket a scenario lands in — and the defect was always
 * that a scenario landed in none of them.
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
  collectAllBindings,
  collectGoBindings,
  discoverFeatureFiles,
  enforcedIntentTags,
  findIntentTagViolations,
  isEntryModule,
  isHidden,
  isInert,
  isPartiallyInert,
  parseFeature,
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

function tsAnnotationsFor(tsSource: string): {
  bindings: string[];
  dangling: string[];
} {
  writeFileSync(join(root, "probe.test.ts"), tsSource, "utf8");
  const { bindings, dangling } = collectAllBindings([root]);
  return {
    bindings: bindings.map((b) => b.title),
    dangling: dangling.map((d) => d.title),
  };
}

describe("collectAllBindings", () => {
  describe("given an annotation directly above an it call", () => {
    describe("when the file is collected", () => {
      it("collects the binding and reports nothing dangling", () => {
        expect(
          tsAnnotationsFor(
            [
              'describe("given a thing", () => {',
              '  /** @scenario "A real binding" */',
              '  it("does the thing", () => {});',
              "});",
            ].join("\n"),
          ),
        ).toEqual({ bindings: ["A real binding"], dangling: [] });
      });
    });
  });

  // The failure this check exists for: above a describe an annotation reads
  // exactly like a binding, binds nothing, and used to be dropped in silence —
  // so the scenario reported as covered by a test that never ran for it.
  describe("given an annotation above a describe rather than an it", () => {
    describe("when the file is collected", () => {
      it("reports it as dangling instead of dropping it", () => {
        expect(
          tsAnnotationsFor(
            [
              '/** @scenario "Binds nothing at all" */',
              'describe("given a thing", () => {',
              '  it("does the thing", () => {});',
              "});",
            ].join("\n"),
          ),
        ).toEqual({ bindings: [], dangling: ["Binds nothing at all"] });
      });
    });
  });

  // Only the last annotation in a block is adjacent to the test call, so the
  // earlier ones bind nothing — the trap that left a whole feature file with
  // zero real binders.
  describe("given several annotations stacked in one JSDoc block", () => {
    describe("when the file is collected", () => {
      it("binds only the last and reports the rest as dangling", () => {
        expect(
          tsAnnotationsFor(
            [
              "/**",
              ' * @scenario "First of two"',
              ' * @scenario "Second of two"',
              " */",
              'it("does the thing", () => {});',
            ].join("\n"),
          ),
        ).toEqual({ bindings: ["Second of two"], dangling: ["First of two"] });
      });
    });
  });

  describe("given an annotation written in a multi-line JSDoc above its it", () => {
    describe("when the file is collected", () => {
      it("binds it rather than losing it to the block's own close", () => {
        expect(
          tsAnnotationsFor(
            [
              "/**",
              " * Why this test exists.",
              ' * @scenario "Natural JSDoc style"',
              " */",
              'it("does the thing", () => {});',
            ].join("\n"),
          ),
        ).toEqual({ bindings: ["Natural JSDoc style"], dangling: [] });
      });
    });
  });

  describe("given an annotation separated from its it by an intervening comment", () => {
    describe("when the file is collected", () => {
      it("still binds it", () => {
        expect(
          tsAnnotationsFor(
            [
              '/** @scenario "Comment in between" */',
              "// a note about the test below",
              'it("does the thing", () => {});',
            ].join("\n"),
          ),
        ).toEqual({ bindings: ["Comment in between"], dangling: [] });
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

/**
 * Classify a fixture feature file the way `buildReport` does, so the tests below
 * drive the accounting from real Gherkin text rather than from hand-built
 * report objects. The point of these cases is which SCENARIOS land in which
 * bucket, and the tags on the page are the only input that decides it.
 */
function parseGherkin(gherkin: string) {
  const path = join(root, "probe.feature");
  writeFileSync(path, gherkin, "utf8");
  return parseFeature(path);
}

function classify(gherkin: string) {
  const all = parseGherkin(gherkin);
  const unimplemented = all.filter((s) => s.tags.includes("@unimplemented"));
  const hidden = all.filter(isHidden);
  // Whatever is neither parked nor hidden carries a binding tag, which is what
  // `buildReport` counts as enforced. Deriving it by subtraction is what makes
  // the exhaustiveness assertions below mean something.
  const enforced = all
    .filter((s) => !unimplemented.includes(s) && !hidden.includes(s))
    .map((s) => ({ ...s, bindings: [] as [] }));
  return {
    enforced,
    unimplemented: unimplemented.map((s) => s.title),
    hidden,
    scenarios: enforced,
    totalScenarios: all.length,
    total: all.length,
  };
}

describe("isPartiallyInert", () => {
  describe("given a file where one scenario is tagged and the rest are not", () => {
    describe("when the floor is applied", () => {
      it("reports the file as partially inert and names every untagged scenario", () => {
        // The defect this class exists for: a single @unit used to promote the
        // whole file to "enforced", and the untagged siblings were then counted
        // nowhere at all while the file printed `✓ all bound`.
        const r = classify(`Feature: Batch progress
  @unit
  Scenario: The same event applied twice moves the counter once
    Given an event

  Scenario: Batch progress is derived from its member runs
    Given a batch

  Scenario: An archived run leaves the denominator
    Given an archived run
`);

        expect(isPartiallyInert({ ...r, hiddenScenarios: r.hidden })).toBe(
          true,
        );
        expect(r.hidden.map((s) => s.title)).toEqual([
          "Batch progress is derived from its member runs",
          "An archived run leaves the denominator",
        ]);
      });
    });
  });

  describe("given a file where every scenario is tagged or parked", () => {
    describe("when the floor is applied", () => {
      it("does not report the file as partially inert", () => {
        const r = classify(`Feature: Fully accounted
  @unit
  Scenario: A tagged one
    Given a thing

  @unimplemented
  Scenario: A parked one
    Given a thing
`);

        expect(isPartiallyInert({ ...r, hiddenScenarios: r.hidden })).toBe(
          false,
        );
      });
    });
  });

  describe("given a file where nothing at all is tagged", () => {
    describe("when both floors are applied", () => {
      it("reports the file as inert but not as partially inert", () => {
        // The two classes are disjoint on purpose — a file enforcing nothing
        // belongs to LEGACY_INERT, and counting it twice would let a removal
        // from one list be masked by the other.
        const r = classify(`Feature: Nothing tagged
  Scenario: One
    Given a thing

  Scenario: Two
    Given a thing
`);

        expect(isInert(r)).toBe(true);
        expect(isPartiallyInert({ ...r, hiddenScenarios: r.hidden })).toBe(
          false,
        );
      });
    });
  });

  describe("given a scenario carrying both a binding tag and @unimplemented", () => {
    describe("when the scenario is classified", () => {
      it("counts it as parked and not as hidden", () => {
        // Parked wins, so the scenario cannot be counted in two buckets at once
        // and inflate the hidden total.
        const r = classify(`Feature: Both tags
  @unit @unimplemented
  Scenario: Tagged and parked at the same time
    Given a thing
`);

        expect(r.enforced).toHaveLength(0);
        expect(r.unimplemented).toEqual(["Tagged and parked at the same time"]);
        expect(r.hidden).toHaveLength(0);
      });
    });
  });

  describe("given a file mixing every kind of tag", () => {
    describe("when the scenarios are classified", () => {
      it("places each scenario in exactly one bucket", () => {
        // The whole point of the new class: enforced + parked + hidden must
        // account for the file completely, or a scenario has fallen through.
        const r = classify(`Feature: Mixed
  @unit
  Scenario: Enforced
    Given a thing

  @unimplemented
  Scenario: Parked
    Given a thing

  @deferred
  Scenario: Privately parked
    Given a thing

  Scenario: Untagged
    Given a thing
`);

        expect(
          r.enforced.length + r.unimplemented.length + r.hidden.length,
        ).toBe(r.total);
        expect(r.hidden.map((s) => s.title)).toEqual([
          "Privately parked",
          "Untagged",
        ]);
      });
    });
  });
});

describe("findIntentTagViolations", () => {
  const enforcedTags = ["@deferred", "@postponed"];

  function violationsIn(gherkin: string) {
    return findIntentTagViolations({
      feature: "specs/probe.feature",
      scenarios: parseGherkin(gherkin),
      enforcedTags,
    });
  }

  describe("given a scenario parked with a tag the checker does not count", () => {
    describe("when the scenarios are scanned", () => {
      it("reports the scenario and names the offending tag", () => {
        // @deferred reads like a recorded decision, which is what made it worse
        // than no tag: the scenario was neither enforced nor parked.
        const found = violationsIn(`Feature: Private convention
  @deferred
  Scenario: A reader still shows the report that arrived last
    Given a span
`);

        expect(found).toHaveLength(1);
        expect(found[0]?.title).toBe(
          "A reader still shows the report that arrived last",
        );
        expect(found[0]?.tags).toEqual(["@deferred"]);
      });
    });
  });

  describe("given the same tag sitting next to @unimplemented", () => {
    describe("when the scenarios are scanned", () => {
      it("reports nothing, because the verdict was given", () => {
        // Keeping the private word as a human note is fine once the scenario
        // also carries the spelling the checker counts.
        expect(
          violationsIn(`Feature: Note alongside a verdict
  @deferred @unimplemented
  Scenario: Tamper-evidence is filed as follow-up
    Given a codebase
`),
        ).toEqual([]);
      });
    });
  });

  describe("given the same tag sitting next to a binding tag", () => {
    describe("when the scenarios are scanned", () => {
      it("reports nothing, because the scenario is enforced", () => {
        expect(
          violationsIn(`Feature: Note on an enforced scenario
  @deferred @integration
  Scenario: Something we actually test
    Given a thing
`),
        ).toEqual([]);
      });
    });
  });

  describe("given an intent tag still tolerated by the ratchet", () => {
    describe("when the scenarios are scanned", () => {
      it("reports nothing, so pre-existing conventions do not fail the build", () => {
        // @planned is absent from `enforcedTags` here, standing in for a tag
        // still listed in LEGACY_INTENT_TAGS.
        expect(
          violationsIn(`Feature: Tolerated convention
  @planned
  Scenario: Something nobody has retagged yet
    Given a thing
`),
        ).toEqual([]);
      });
    });
  });

  describe("given a plainly untagged scenario", () => {
    describe("when the scenarios are scanned", () => {
      it("reports nothing, leaving it to the partially-inert floor", () => {
        // Silence is a different defect from a misspelled verdict, and the two
        // must not double-report the same scenario.
        expect(
          violationsIn(`Feature: Plain silence
  Scenario: Nobody said anything about this one
    Given a thing
`),
        ).toEqual([]);
      });
    });
  });
});

describe("enforcedIntentTags", () => {
  describe("given a tag the ratchet still tolerates", () => {
    describe("when the enforced set is derived", () => {
      it("excludes the tolerated tag and keeps the rest", () => {
        expect(
          enforcedIntentTags({
            all: ["@deferred", "@planned", "@wip"],
            tolerated: ["@planned"],
          }),
        ).toEqual(["@deferred", "@wip"]);
      });
    });
  });

  describe("given nothing is tolerated", () => {
    describe("when the enforced set is derived", () => {
      it("enforces every listed tag", () => {
        expect(
          enforcedIntentTags({ all: ["@deferred", "@wip"], tolerated: [] }),
        ).toEqual(["@deferred", "@wip"]);
      });
    });
  });

  describe("given the lists the checker actually ships", () => {
    describe("when the enforced set is derived", () => {
      it("enforces at least one tag, so the rule is not vacuous", () => {
        // A ratchet that tolerated everything it knows about would pass while
        // enforcing nothing — the same shape of hole this whole check exists to
        // close.
        expect(enforcedIntentTags().length).toBeGreaterThan(0);
      });
    });
  });
});
