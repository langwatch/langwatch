import { afterAll, describe, expect, it } from "vitest";
import { positionalParameterListRule } from "../../src/rules/positional-parameter-list.rule.mjs";
import { createFixtureWorkspace, runRule } from "../../src/testing.mjs";

const workspace = createFixtureWorkspace({});

afterAll(() => workspace.cleanup());

function report(code, options = []) {
  return runRule(positionalParameterListRule, {
    code,
    cwd: workspace.cwd,
    filename: "modules/agent/server/src/services/agent.service.ts",
    options,
  });
}

describe("given a function", () => {
  describe("when it takes four positional parameters", () => {
    /** @scenario "A function with four positional parameters is reported" */
    it("reports tooManyPositionalParameters naming the function and its count", () => {
      const found = report("export function build(a, b, c, d) { return a + b + c + d; }");

      expect(found).toHaveLength(1);
      expect(found[0].messageId).toBe("tooManyPositionalParameters");
      expect(found[0].data.name).toBe("build");
      expect(found[0].data.count).toBe(4);
    });
  });

  describe("when it takes three positional parameters", () => {
    /** @scenario "Three parameters are left alone" */
    it("reports nothing", () => {
      expect(report("export function build(a, b, c) { return a + b + c; }")).toEqual([]);
    });
  });

  describe("when a trailing rest parameter follows three named parameters", () => {
    it("does not count the rest parameter as a fourth", () => {
      expect(report("export function build(a, b, c, ...rest) { return [a, b, c, rest]; }")).toEqual(
        [],
      );
    });
  });

  describe("when the caller raises the max option", () => {
    it("reports nothing at max 4 for a function that would otherwise trip the default", () => {
      expect(
        report("export function build(a, b, c, d) { return a + b + c + d; }", [{ max: 4 }]),
      ).toEqual([]);
    });
  });

  describe("when it is anonymous", () => {
    it("reports it as this function", () => {
      const found = report("(function (a, b, c, d) { return a + b + c + d; })();");

      expect(found[0].data.name).toBe("this function");
    });
  });
});

describe("given a class", () => {
  describe("when its constructor takes four positional parameters", () => {
    /** @scenario "A constructor is left alone" */
    it("reports nothing", () => {
      expect(
        report(
          "export class Service { constructor(a, b, c, d) { this.a = a; this.b = b; this.c = c; this.d = d; } }",
        ),
      ).toEqual([]);
    });
  });
});

describe("given a callback", () => {
  describe("when a four-parameter arrow is passed as a call argument", () => {
    /** @scenario "A callback's arity is left alone" */
    it("reports nothing", () => {
      expect(report("registerHandler((a, b, c, d) => a + b + c + d);")).toEqual([]);
    });
  });
});

describe("given a TSMethodSignature", () => {
  describe("when it declares four positional parameters", () => {
    it("reports tooManyPositionalParameters naming the method", () => {
      const found = report(
        "export interface Builder { build(a: number, b: number, c: number, d: number): void; }",
      );

      expect(found).toHaveLength(1);
      expect(found[0].messageId).toBe("tooManyPositionalParameters");
      expect(found[0].data.name).toBe("build");
    });
  });
});
