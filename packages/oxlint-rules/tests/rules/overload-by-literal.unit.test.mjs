import { afterAll, describe, expect, it } from "vitest";

import { overloadByLiteralRule } from "../../src/index.mjs";
import { createFixtureWorkspace, runRule } from "../../src/testing.mjs";

const workspace = createFixtureWorkspace({
  features: { project: { layoutVersion: 0, roles: { contract: {} } } },
});

afterAll(() => workspace.cleanup());

const CONTRACT = "modules/project/contract/src/example.contract.ts";
const ALLOWED =
  "Give the two behaviours two names, or one signature whose return type already admits the" +
  " absent case. An overload set the reader has to diff is not documentation.";

function report(code, filename = CONTRACT) {
  return runRule(overloadByLiteralRule, { code, cwd: workspace.cwd, filename });
}

describe("given an overload set in a feature contract", () => {
  describe("when two overloads differ only by a boolean literal property", () => {
    /** @scenario "Overloads that differ only by a boolean literal are reported with the property" */
    it("reports splitTheOverloads naming the function and the property", () => {
      const found =
        report(`export function configUrl(options?: { env?: string; optional?: false }): Leaf<string>;
export function configUrl(options: { env?: string; optional: true }): Leaf<string | undefined>;
export function configUrl(options?: { env?: string; optional?: boolean }): Leaf<string | undefined> {
  return leaf(options);
}`);

      expect(found).toHaveLength(1);
      expect(found[0].messageId).toBe("splitTheOverloads");
      expect(found[0].message).toBe(
        "configUrl carries overloads that differ only by `optional: true` versus" +
          ` \`optional: false\`. ${ALLOWED}`,
      );
    });

    it("reads method signatures on an interface the same way", () => {
      const found = report(`export interface Store {
  read(options: { raw: true }): Buffer;
  read(options: { raw: false }): string;
}`);

      expect(found.map((entry) => entry.messageId)).toEqual(["splitTheOverloads"]);
    });
  });

  describe("when a class declares overloads that differ only by a boolean literal", () => {
    /** @scenario "Class method overloads that differ only by a boolean literal are reported" */
    it("reports splitTheOverloads at the first overload's line", () => {
      const found = report(`export class Store {
  id = 1;
  read(options: { raw: true }): Buffer;
  read(options: { raw: false }): string;
  read(options: { raw: boolean }): Buffer | string {
    return load(options);
  }
}`);

      expect(found.map((entry) => [entry.messageId, entry.line])).toEqual([
        ["splitTheOverloads", 3],
      ]);
    });
  });

  describe("when the same name is declared in two separate scopes", () => {
    /** @scenario "Same-named signatures in different scopes are not one overload set" */
    it("reports nothing", () => {
      expect(
        report(`export interface Raw {
  read(options: { raw: true }): Buffer;
}
export interface Text {
  read(options: { raw: false }): string;
}`),
      ).toEqual([]);
    });
  });

  describe("when the overloads differ by something the reader can name", () => {
    /** @scenario "Overloads that differ by an actual type are left alone" */
    it("reports nothing", () => {
      expect(
        report(`export function create(options: SchemaOptions): Config;
export function create(options: DefinitionOptions): Config;
export function create(options: SchemaOptions | DefinitionOptions): Config {
  return build(options);
}`),
      ).toEqual([]);
    });

    it("reports nothing when only one signature carries the literal", () => {
      expect(
        report(`export function create(options: { optional: true }): Config;
export function create(options: DefinitionOptions): Config;
export function create(options: unknown): Config {
  return build(options);
}`),
      ).toEqual([]);
    });
  });
});
