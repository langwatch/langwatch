import { afterAll, describe, expect, it } from "vitest";
import { jsxFromHookRule } from "../../src/rules/jsx-from-hook.rule.mjs";
import { createFixtureWorkspace, runRule } from "../../src/testing.mjs";

const workspace = createFixtureWorkspace({
  features: { agent: { layoutVersion: 0, roles: { browser: {} } } },
});

afterAll(() => workspace.cleanup());

function report(code, filename) {
  return runRule(jsxFromHookRule, { code, cwd: workspace.cwd, filename });
}

describe("given a production .tsx file", () => {
  describe("when a hook returns a JSX element directly", () => {
    /** @scenario "a hook returning JSX is reported" */
    it("reports hookReturnsJsx", () => {
      const found = report(
        "function useThing() { return <div/>; }",
        "modules/agent/browser/src/use-thing.tsx",
      );

      expect(found).toHaveLength(1);
      expect(found[0].messageId).toBe("hookReturnsJsx");
      expect(found[0].data.name).toBe("useThing");
    });
  });

  describe("when a hook returns JSX from one branch of a conditional", () => {
    /** @scenario "a hook returning JSX is reported" */
    it("reports hookReturnsJsx", () => {
      const found = report(
        "function useThing(open) { return open ? <div/> : null; }",
        "modules/agent/browser/src/use-thing.tsx",
      );

      expect(found).toHaveLength(1);
      expect(found[0].messageId).toBe("hookReturnsJsx");
    });
  });

  describe("when a hook returns state and callbacks", () => {
    /** @scenario "a hook returning state is left alone" */
    it("reports nothing", () => {
      expect(
        report(
          "function useThing() { const open = true; const onOpen = () => {}; return { open, onOpen }; }",
          "modules/agent/browser/src/use-thing.tsx",
        ),
      ).toEqual([]);
    });
  });

  describe("when a hook returns a render callback", () => {
    /** @scenario "a hook returning a render callback is left alone" */
    it("reports nothing", () => {
      expect(
        report(
          "function useThing() { return () => <div/>; }",
          "modules/agent/browser/src/use-thing.tsx",
        ),
      ).toEqual([]);
    });
  });

  describe("when the function is not named like a hook", () => {
    it("reports nothing", () => {
      expect(
        report(
          "function renderThing() { return <div/>; }",
          "modules/agent/browser/src/render-thing.tsx",
        ),
      ).toEqual([]);
    });
  });

  describe("when a JSX-returning function lives in an arrow-declared hook", () => {
    /** @scenario "a hook returning JSX is reported" */
    it("reports hookReturnsJsx", () => {
      const found = report(
        "const useThing = () => { return <div/>; };",
        "modules/agent/browser/src/use-thing.tsx",
      );

      expect(found).toHaveLength(1);
      expect(found[0].messageId).toBe("hookReturnsJsx");
      expect(found[0].data.name).toBe("useThing");
    });
  });

  describe("when a hook's nested effect returns a cleanup function", () => {
    it("reports nothing", () => {
      expect(
        report(
          "function useThing() { useEffect(() => { return cleanup(); }); return {}; }",
          "modules/agent/browser/src/use-thing.tsx",
        ),
      ).toEqual([]);
    });
  });
});

describe("given the file is a test", () => {
  it("reports nothing", () => {
    expect(
      report(
        "function useThing() { return <div/>; }",
        "modules/agent/browser/src/__tests__/use-thing.unit.test.tsx",
      ),
    ).toEqual([]);
  });
});
