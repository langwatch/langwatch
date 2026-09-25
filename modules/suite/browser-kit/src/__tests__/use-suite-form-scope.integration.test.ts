/**
 * @vitest-environment jsdom
 * Characterization of `useSuiteForm`'s scope memory, scoped scenario count,
 * target mappings and the reset from a stored plan.
 */

import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { useSuiteForm } from "../behavior/use-suite-form.ts";

const scenarios = [
  { id: "scen_1", name: "Refund", labels: ["billing"], testSuiteId: "ts_a" },
  { id: "scen_2", name: "Policy", labels: ["safety"], testSuiteId: "ts_b" },
  { id: "scen_3", name: "Checkout", labels: ["billing", "safety"], testSuiteId: null },
];

const baseParams = {
  suite: null,
  isOpen: true,
  suiteId: undefined,
  scenarios,
  agents: [{ id: "agent_1", name: "Prod Agent", type: "http" }],
  prompts: [{ id: "prompt_1", handle: "test-prompt" }],
};

const storedPlan = {
  id: "suite_1",
  projectId: "proj_1",
  name: "Nightly",
  slug: "nightly",
  kind: "run_plan",
  scope: { mode: "labels", labels: ["safety"] },
  description: null,
  scenarioIds: [],
  targets: [{ type: "http", referenceId: "agent_1" }],
  repeatCount: 2,
  labels: ["ci"],
  simulatorModel: "openai/gpt-5",
  judgeModel: null,
};

describe("useSuiteForm() scope", () => {
  describe("given the scope covers every scenario", () => {
    it("counts every active scenario", () => {
      const { result } = renderHook(() => useSuiteForm(baseParams));
      act(() => result.current.setScopeMode("all"));
      expect(result.current.scopedScenarioIds).toEqual(["scen_1", "scen_2", "scen_3"]);
    });
  });

  describe("given the scope follows test suites", () => {
    it("counts the scenarios in the ticked suites and remembers them across modes", () => {
      const { result } = renderHook(() => useSuiteForm(baseParams));
      act(() => result.current.toggleScopeTestSuite("ts_b"));
      expect(result.current.scope).toEqual({ mode: "test_suites", testSuiteIds: ["ts_b"] });
      expect(result.current.scopedScenarioIds).toEqual(["scen_2"]);

      act(() => result.current.setScopeMode("labels"));
      act(() => result.current.setScopeMode("test_suites"));
      expect(result.current.scope).toEqual({ mode: "test_suites", testSuiteIds: ["ts_b"] });

      act(() => result.current.toggleScopeTestSuite("ts_b"));
      expect(result.current.scopedScenarioIds).toEqual([]);
    });
  });

  describe("given the scope follows labels", () => {
    it("counts the scenarios carrying any ticked label", () => {
      const { result } = renderHook(() => useSuiteForm(baseParams));
      act(() => result.current.toggleScopeLabel("safety"));
      expect(result.current.scopedScenarioIds).toEqual(["scen_2", "scen_3"]);
      act(() => result.current.setScopeMode("scenarios"));
      act(() => result.current.setScopeMode("labels"));
      expect(result.current.scope).toEqual({ mode: "labels", labels: ["safety"] });
    });
  });

  describe("given the scope lists scenarios", () => {
    it("counts the ticked scenarios", () => {
      const { result } = renderHook(() => useSuiteForm(baseParams));
      act(() => result.current.setScopeMode("scenarios"));
      act(() => result.current.toggleScenario("scen_3"));
      expect(result.current.scopedScenarioIds).toEqual(["scen_3"]);
    });
  });

  describe("when a target gets a mapping and then loses it", () => {
    it("writes the mapping onto that prompt only, then drops it", () => {
      const { result } = renderHook(() => useSuiteForm(baseParams));
      const target = { type: "prompt" as const, referenceId: "prompt_1" };
      act(() => result.current.toggleTarget({ type: "http", referenceId: "agent_1" }));
      act(() => result.current.toggleTarget(target));
      const mapping = { type: "source" as const, sourceId: "scenario", path: ["input"] };
      act(() => result.current.setTargetMapping({ target, identifier: "input", mapping }));
      expect(result.current.selectedTargets).toMatchSnapshot();
      act(() =>
        result.current.setTargetMapping({ target, identifier: "input", mapping: undefined }),
      );
      expect(result.current.selectedTargets).toEqual([
        { type: "http", referenceId: "agent_1" },
        { type: "prompt", referenceId: "prompt_1" },
      ]);
    });
  });

  describe("given a stored plan opens", () => {
    it("loads its values and remembers its scope", () => {
      const { result } = renderHook(() =>
        useSuiteForm({ ...baseParams, suite: storedPlan, suiteId: "suite_1" }),
      );
      expect(result.current.form.getValues()).toMatchSnapshot();
      act(() => result.current.setScopeMode("all"));
      act(() => result.current.setScopeMode("labels"));
      expect(result.current.scope).toEqual({ mode: "labels", labels: ["safety"] });
    });
  });

  describe("given the drawer reopens empty after edits", () => {
    it("resets to the defaults and forgets the remembered scope", () => {
      const { result, rerender } = renderHook(
        (props: { isOpen: boolean }) => useSuiteForm({ ...baseParams, isOpen: props.isOpen }),
        { initialProps: { isOpen: true } },
      );
      act(() => result.current.toggleScopeLabel("billing"));
      act(() => result.current.setScenarioSearch("ref"));
      rerender({ isOpen: false });
      rerender({ isOpen: true });
      expect(result.current.scenarioSearch).toBe("");
      act(() => result.current.setScopeMode("labels"));
      expect(result.current.scope).toEqual({ mode: "labels", labels: [] });
    });
  });
});
