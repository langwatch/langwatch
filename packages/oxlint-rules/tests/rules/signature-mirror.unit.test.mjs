import { afterAll, describe, expect, it } from "vitest";

import { signatureMirrorRule } from "../../src/rules/signature-mirror.rule.mjs";
import { createFixtureWorkspace, runRule } from "../../src/testing.mjs";

const workspace = createFixtureWorkspace({});

afterAll(() => workspace.cleanup());

function report(code, filename = "modules/trace/contract/src/trace.commands.ts") {
  return runRule(signatureMirrorRule, { code, cwd: workspace.cwd, filename });
}

describe("given a contract source file", () => {
  describe("when an exported type mirrors a function through a global utility type", () => {
    /** @scenario "A boundary type mirrored through a global utility type is reported where it is written" */
    it("reports mirroredSignature at the reference, naming the utility", () => {
      const code = [
        "declare function createTrace(input: { id: string }): void;",
        "export type CreateTraceInput = Parameters<typeof createTrace>[0];",
      ].join("\n");

      expect(report(code)).toEqual([
        expect.objectContaining({
          messageId: "mirroredSignature",
          line: 2,
          data: { name: "Parameters" },
        }),
      ]);
    });

    it.each(["ReturnType", "ConstructorParameters"])("reports %s too", (name) => {
      expect(report(`export type Mirror = ${name}<typeof x>;`)).toEqual([
        expect.objectContaining({ data: { name } }),
      ]);
    });
  });

  describe("when the utility name is a local declaration, type parameter or import", () => {
    /** @scenario "A local declaration that shadows the utility name is not a mirror" */
    it.each([
      ["a local type alias", "type Parameters<T> = T;\nexport type A = Parameters<string>;"],
      [
        "an import",
        'import type { Parameters } from "./own";\nexport type A = Parameters<string>;',
      ],
      ["a type parameter", "export type A<Parameters> = { value: Parameters };"],
      [
        "a declaration inside a function body",
        "export function f() { interface ReturnType<T> { v: T } let x: ReturnType<string>; return x; }",
      ],
    ])("reports nothing for %s", (_label, code) => {
      expect(report(code)).toEqual([]);
    });
  });

  describe("when a declaration in a sibling scope has the utility's name", () => {
    it("still reports the global use outside that scope", () => {
      const code = [
        "function inner() { type Parameters<T> = T; }",
        "export type A = Parameters<typeof inner>;",
      ].join("\n");

      expect(report(code)).toEqual([expect.objectContaining({ line: 2 })]);
    });
  });
});

describe("given the boundary paths", () => {
  const code = "export type Mirror = ReturnType<typeof x>;";

  /** @scenario "Contracts, module app folders and composition roots are boundaries" */
  it.each([
    "modules/trace/contract/src/trace.ts",
    "enterprise/modules/scim/contract/src/scim.ts",
    "modules/trace/process/src/app/trace.app.ts",
    "apps/api/src/trace.composition.ts",
  ])("reports %s", (filename) => {
    expect(report(code, filename)).toHaveLength(1);
  });

  /** @scenario "Services, tests and non-boundary application files are not read" */
  it.each([
    "modules/trace/process/src/services/trace.service.ts",
    "modules/trace/contract/src/__tests__/trace.ts",
    "modules/trace/contract/src/trace.test.ts",
    "modules/trace/contract/src/trace.d.ts",
    "apps/api/src/main.ts",
    "apps/ui/src/trace.composition.ts",
  ])("reports nothing for %s", (filename) => {
    expect(report(code, filename)).toEqual([]);
  });
});
