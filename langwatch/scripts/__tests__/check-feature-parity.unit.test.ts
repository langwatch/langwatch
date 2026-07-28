/**
 * @vitest-environment node
 *
 * Go-side binding collection for scripts/check-feature-parity.ts.
 *
 * The proximity check is what decides whether an `@scenario` annotation counts
 * as a binding, so a form it fails to recognise does not error — the annotation
 * is silently dropped and the scenario it was meant to bind is reported unbound.
 * These tests pin the `t.Run` subtest forms that appear in the repo's Go tests,
 * including the multiline one gofmt preserves verbatim.
 */

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { collectGoBindings } from "../check-feature-parity";

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
            ].join("\n")
          )
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
            ].join("\n")
          )
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
            ].join("\n")
          )
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
            ].join("\n")
          )
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
            ].join("\n")
          )
        ).toEqual([]);
      });
    });
  });
});
