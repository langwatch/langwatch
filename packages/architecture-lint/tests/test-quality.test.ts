import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { lintTestQuality } from "../src";

function writeFixture(root: string, file: string, source: string): string {
  const path = join(root, file);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${source}\n`);
  return path;
}

function policies(root: string, file: string): string[] {
  return lintTestQuality(root, { files: [file] }).map((violation) => violation.policy);
}

describe("test quality", () => {
  it("rejects tests without assertions", () => {
    const root = mkdtempSync(join(tmpdir(), "test-quality-no-assertion-"));
    const file = writeFixture(
      root,
      "src/example.test.ts",
      'it("does nothing", () => { doWork(); });',
    );

    expect(policies(root, file)).toEqual(["test-quality"]);
  });

  it("does not accept an unfinished expect call as an assertion", () => {
    const root = mkdtempSync(join(tmpdir(), "test-quality-unfinished-expect-"));
    const file = writeFixture(
      root,
      "src/example.test.ts",
      'it("forgets the matcher", () => { expect(doWork()); });',
    );

    expect(policies(root, file)).toEqual(["test-quality"]);
  });

  it("accepts async expectation matchers", () => {
    const root = mkdtempSync(join(tmpdir(), "test-quality-async-expect-"));
    const file = writeFixture(
      root,
      "src/example.test.ts",
      'it("expects a rejection", async () => { await expect(doWork()).rejects.toThrow("nope"); });',
    );

    expect(policies(root, file)).toEqual([]);
  });

  it("recognises parameterised test and suite callbacks", () => {
    const root = mkdtempSync(join(tmpdir(), "test-quality-each-callbacks-"));
    const file = writeFixture(
      root,
      "src/example.test.ts",
      [
        'it.each(["one"])("%s", (value) => { expect(value).toBe("one"); });',
        'describe.each(["two"])("%s", (value) => { it("works", () => { expect(value).toBe("two"); }); });',
      ].join("\n"),
    );

    expect(policies(root, file)).toEqual([]);
  });

  it("accepts expect, node assert, and type assertions", () => {
    const root = mkdtempSync(join(tmpdir(), "test-quality-assertions-"));
    const file = writeFixture(
      root,
      "src/example.test.ts",
      [
        'it("expects", () => { expect(doWork()).toBe("ok"); });',
        'it("asserts", () => { assert.equal(doWork(), "ok"); });',
        'it("types", () => { expectTypeOf(doWork()).toEqualTypeOf<string>(); });',
      ].join("\n"),
    );

    expect(policies(root, file)).toEqual([]);
  });

  it("accepts a local helper that contains real assertions", () => {
    const root = mkdtempSync(join(tmpdir(), "test-quality-assertion-helper-"));
    const file = writeFixture(
      root,
      "src/example.test.ts",
      [
        'function assertParity(actual: string) { expect(actual).toBe("ok"); }',
        'it("checks parity", () => { assertParity(doWork()); });',
      ].join("\n"),
    );

    expect(policies(root, file)).toEqual([]);
  });

  it("does not trust an assertion-shaped helper without an assertion", () => {
    const root = mkdtempSync(join(tmpdir(), "test-quality-empty-helper-"));
    const file = writeFixture(
      root,
      "src/example.test.ts",
      [
        "function assertParity(actual: string) { log(actual); }",
        'it("checks nothing", () => { assertParity(doWork()); });',
      ].join("\n"),
    );

    expect(policies(root, file)).toEqual(["test-quality"]);
  });

  it("rejects known literal tautologies", () => {
    const root = mkdtempSync(join(tmpdir(), "test-quality-tautology-"));
    const file = writeFixture(
      root,
      "src/example.test.ts",
      [
        'it("true", () => { expect(true).toBe(true); });',
        'it("same literal", () => { expect("same").toStrictEqual("same"); });',
        'it("empty", () => { expect("").toMatchSnapshot(); });',
      ].join("\n"),
    );

    expect(policies(root, file)).toEqual(["test-quality", "test-quality", "test-quality"]);
  });

  it("rejects a static literal echoed through a schema parser", () => {
    const root = mkdtempSync(join(tmpdir(), "test-quality-schema-echo-"));
    const file = writeFixture(
      root,
      "src/suite.kind.unit.test.ts",
      [
        'import { suiteKindSchema } from "./suite.kind";',
        'it("accepts custom", () => { expect(suiteKindSchema.parse("custom")).toBe("custom"); });',
      ].join("\n"),
    );

    const violations = lintTestQuality(root, { files: [file] });
    expect(violations).toMatchObject([
      {
        policy: "test-quality",
        message: "Assertion only echoes a static literal through a schema parser.",
      },
    ]);
  });

  it("rejects an imported subject that the test mocks", () => {
    const root = mkdtempSync(join(tmpdir(), "test-quality-mocked-subject-"));
    const file = writeFixture(
      root,
      "src/widget.unit.test.ts",
      [
        'import { widget } from "./widget";',
        'vi.mock("./widget");',
        'it("uses the mocked subject", () => { expect(widget()).toBe("ok"); });',
      ].join("\n"),
    );

    expect(policies(root, file)).toEqual(["test-quality"]);
  });

  it("does not treat a mocked collaborator as a mocked subject", () => {
    const root = mkdtempSync(join(tmpdir(), "test-quality-mocked-collaborator-"));
    const file = writeFixture(
      root,
      "src/widget.unit.test.ts",
      [
        'import { loadUser } from "./user";',
        'import { widget } from "./widget";',
        'vi.mock("./user");',
        'it("uses its subject", () => { expect(widget(loadUser())).toBe("ok"); });',
      ].join("\n"),
    );

    expect(policies(root, file)).toEqual([]);
  });

  it("rejects exact duplicate test bodies but not different bodies", () => {
    const root = mkdtempSync(join(tmpdir(), "test-quality-duplicate-"));
    const file = writeFixture(
      root,
      "src/example.test.ts",
      [
        'it("first", () => { expect(doWork()).toBe("ok"); });',
        'it("second", () => { expect(doWork()).toBe("ok"); });',
        'it("third", () => { expect(doOtherWork()).toBe("ok"); });',
      ].join("\n"),
    );

    const violations = lintTestQuality(root, { files: [file] });
    expect(violations).toHaveLength(1);
    expect(violations[0]).toMatchObject({
      policy: "test-quality",
      message: "Test body exactly duplicates the test at line 1.",
    });
  });

  it("permits identical bodies in different suite scopes", () => {
    const root = mkdtempSync(join(tmpdir(), "test-quality-duplicate-scope-"));
    const file = writeFixture(
      root,
      "src/example.test.ts",
      [
        'describe("first state", () => { it("works", () => { expect(doWork()).toBe("ok"); }); });',
        'describe("second state", () => { it("works", () => { expect(doWork()).toBe("ok"); }); });',
      ].join("\n"),
    );

    expect(policies(root, file)).toEqual([]);
  });

  it("rejects a statically empty inline template snapshot", () => {
    const root = mkdtempSync(join(tmpdir(), "test-quality-empty-inline-snapshot-"));
    const file = writeFixture(
      root,
      "src/example.test.ts",
      'it("snapshots nothing", () => { expect(``).toMatchInlineSnapshot(``); });',
    );

    expect(policies(root, file)).toEqual(["test-quality"]);
  });

  it("rejects empty template snapshots with their printed spelling", () => {
    const root = mkdtempSync(join(tmpdir(), "test-quality-empty-template-snapshots-"));
    const file = writeFixture(
      root,
      "src/example.test.ts",
      [
        'it("array", () => { expect([]).toMatchInlineSnapshot(`[]`); });',
        'it("object", () => { expect({}).toMatchInlineSnapshot(`{}`); });',
        'it("string", () => { expect("").toMatchInlineSnapshot(`""`); });',
      ].join("\n"),
    );

    expect(policies(root, file)).toEqual(["test-quality", "test-quality", "test-quality"]);
  });

  it("only flags literal toBeDefined assertions that must pass", () => {
    const root = mkdtempSync(join(tmpdir(), "test-quality-defined-literals-"));
    const file = writeFixture(
      root,
      "src/example.test.ts",
      [
        'it("null is defined", () => { expect(null).toBeDefined(); });',
        'it("undefined is not defined", () => { expect(undefined).toBeDefined(); });',
      ].join("\n"),
    );

    expect(policies(root, file)).toEqual(["test-quality"]);
  });

  it("only lints test files", () => {
    const root = mkdtempSync(join(tmpdir(), "test-quality-files-"));
    const file = writeFixture(root, "src/example.ts", 'it("does nothing", () => { doWork(); });');

    expect(policies(root, file)).toEqual([]);
  });
});
