import { afterAll, describe, expect, it } from "vitest";

import { effectDerivesStateRule } from "../../src/rules/effect-derives-state.rule.mjs";
import { createFixtureWorkspace, runRule } from "../../src/testing.mjs";

const workspace = createFixtureWorkspace({
  features: { agent: { layoutVersion: 0, roles: { browser: {} } } },
});

afterAll(() => workspace.cleanup());

const FILE = "modules/agent/browser/src/behavior/use-thing.ts";

function report(body, filename = FILE) {
  const code = `function useThing({ items, q }) {\n  const [count, setCount] = useState(0);\n  const [name, setName] = useState("");\n${body}\n}`;

  return runRule(effectDerivesStateRule, { code, cwd: workspace.cwd, filename });
}

describe("given an effect in browser code", () => {
  describe("when its only job is setting state from its dependencies", () => {
    /** @scenario "An effect that only derives state is reported" */
    it("reports effectDerivesState naming the setter", () => {
      const found = report("useEffect(() => { setCount(items.length); }, [items]);");

      expect(found).toHaveLength(1);
      expect(found[0].messageId).toBe("effectDerivesState");
      expect(found[0].data.setter).toBe("setCount");
      expect(found[0].message).toContain("compute the value during render");
    });

    it("reports a concise arrow and several setters", () => {
      expect(report("useEffect(() => setCount(items.length), [items]);")).toHaveLength(1);
      const several = report(
        "React.useLayoutEffect(() => { setCount(items.length); setName(q.data?.name); }, [items, q.data]);",
      );

      expect(several[0].data.setter).toBe("setCount, setName");
    });
  });

  describe("when the effect does anything else", () => {
    /** @scenario "An effect that subscribes, times, touches the DOM or cleans up is left alone" */
    it("leaves subscriptions, timers, cleanups and the DOM alone", () => {
      const bodies = [
        "useEffect(() => { const t = setTimeout(() => setCount(items.length), 5); return () => clearTimeout(t); }, [items]);",
        "useEffect(() => { setCount(items.length); return () => {}; }, [items]);",
        "useEffect(() => { setCount(window.innerWidth + items.length); }, [items]);",
        "useEffect(() => { setCount(ref.current.scrollTop + items.length); }, [items]);",
        "useEffect(() => { document.title = q; setCount(items.length); }, [items]);",
        "useEffect(() => { track(items); }, [items]);",
        "useEffect(() => { if (items) setCount(items.length); }, [items]);",
      ];

      for (const body of bodies) expect(report(body)).toEqual([]);
    });

    it("leaves a mount effect and a literal reset alone", () => {
      expect(report("useEffect(() => { setCount(items.length); }, []);")).toEqual([]);
      expect(report("useEffect(() => { setCount(0); }, [items]);")).toEqual([]);
      expect(report("useEffect(() => { setCount(items.length); });")).toEqual([]);
    });

    it("leaves a setter that is not a useState pair alone", () => {
      expect(report("useEffect(() => { setOther(items.length); }, [items]);")).toEqual([]);
    });
  });

  describe("when the setter is a prop rather than local state", () => {
    it("leaves it alone even when another component owns a useState of that name", () => {
      const code = [
        "function Parent() { const [file, setFile] = useState(null); return null; }",
        "function Child({ setFile, file }) { useEffect(() => { setFile(file); }, [file, setFile]); }",
      ].join("\n");
      const found = runRule(effectDerivesStateRule, { code, cwd: workspace.cwd, filename: FILE });

      expect(found).toEqual([]);
    });
  });

  describe("when the file is a test or outside browser code", () => {
    it("is not governed", () => {
      const body = "useEffect(() => { setCount(items.length); }, [items]);";

      expect(report(body, "modules/agent/browser/src/__tests__/use-thing.unit.test.ts")).toEqual(
        [],
      );
      expect(report(body, "modules/agent/process/src/services/x.ts")).toEqual([]);
    });
  });
});
