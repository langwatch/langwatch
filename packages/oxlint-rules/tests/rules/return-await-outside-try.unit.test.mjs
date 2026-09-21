import { afterAll, describe, expect, it } from "vitest";
import { returnAwaitOutsideTryRule } from "../../src/rules/return-await-outside-try.rule.mjs";
import { createFixtureWorkspace, expectFix, runRule } from "../../src/testing.mjs";

const workspace = createFixtureWorkspace({
  features: { agent: { layoutVersion: 0, roles: { process: {} } } },
});

afterAll(() => workspace.cleanup());

const SERVICE = "modules/agent/process/src/services/agent.service.ts";

function report(code) {
  return runRule(returnAwaitOutsideTryRule, { code, cwd: workspace.cwd, filename: SERVICE });
}

function fix({ code, output, errors = 1 }) {
  expectFix(returnAwaitOutsideTryRule, { code, cwd: workspace.cwd, errors, filename: SERVICE, output });
}

describe("given a governed source file", () => {
  describe("when a return await sits outside any try", () => {
    /** @scenario "A ritual return await outside any try is reported and the await is deleted" */
    it("reports ritualReturnAwait and deletes the await", () => {
      const code = "async function f() { return await g(); }";
      const found = report(code);

      expect(found).toHaveLength(1);
      expect(found[0].messageId).toBe("ritualReturnAwait");
      expect(found[0].data.expression).toBe("g()");

      fix({ code, output: "async function f() { return g(); }" });
    });

    /** @scenario "The fixed file reports nothing" */
    it("reports nothing once the await is stripped", () => {
      expect(report("async function f() { return g(); }")).toEqual([]);
    });

    it("strips the await from a member/call chain argument", () => {
      const code = "async function f() { return await this.repo.find(id); }";

      fix({ code, output: "async function f() { return this.repo.find(id); }" });
    });

    it("strips the await from a template-literal argument", () => {
      const code = "async function f() { return await `${a}${b}`; }";

      fix({ code, output: "async function f() { return `${a}${b}`; }" });
    });
  });

  describe("when a return await sits inside a try", () => {
    /** @scenario "A return await inside a try is left alone" */
    it("reports nothing for a return inside the try block", () => {
      const code = "async function f() { try { return await g(); } catch (e) { throw e; } }";

      expect(report(code)).toEqual([]);
    });

    it("reports nothing for a return inside the finally block", () => {
      const code =
        "async function f() { try { doThing(); } finally { return await cleanup(); } }";

      expect(report(code)).toEqual([]);
    });

    it("reports nothing for a return inside the catch handler", () => {
      const code =
        "async function f() { try { risky(); } catch (e) { return await recover(e); } }";

      expect(report(code)).toEqual([]);
    });
  });

  describe("when the enclosing function has a using declaration in scope", () => {
    /** @scenario "A return await in a function with a using declaration is left alone" */
    it("reports nothing when the function opens an await using resource", () => {
      const code =
        "async function f() { await using db = openDb(); return await g(); }";

      expect(report(code)).toEqual([]);
    });

    it("reports nothing when the function opens a using resource", () => {
      const code = "async function f() { using lock = acquireLock(); return await g(); }";

      expect(report(code)).toEqual([]);
    });

    it("still reports when the using declaration belongs to a nested function", () => {
      const code =
        "async function f() { const inner = async () => { return await g(); }; using lock = acquireLock(); return inner(); }";

      const found = report(code);

      expect(found).toHaveLength(1);
      expect(found[0].messageId).toBe("ritualReturnAwait");
    });
  });

  describe("when the enclosing function is an async generator", () => {
    /** @scenario "A return await in an async generator is left alone" */
    it("reports nothing", () => {
      const code = "async function* g() { return await x; }";

      expect(report(code)).toEqual([]);
    });
  });

  describe("when an outer function's try surrounds an inner function's return", () => {
    /** @scenario "An outer try does not protect an inner function's return await" */
    it("still reports the inner function's return await", () => {
      const code =
        "async function outer() { try { const f = async () => { return await g(); }; } catch (e) {} }";

      const found = report(code);

      expect(found).toHaveLength(1);
      expect(found[0].messageId).toBe("ritualReturnAwait");
    });
  });
});

describe("given a file outside the governed roots", () => {
  describe("when a return await sits outside any try", () => {
    it("reports nothing", () => {
      const found = runRule(returnAwaitOutsideTryRule, {
        code: "async function f() { return await g(); }",
        cwd: workspace.cwd,
        filename: "scripts/one-off.ts",
      });

      expect(found).toEqual([]);
    });
  });
});
