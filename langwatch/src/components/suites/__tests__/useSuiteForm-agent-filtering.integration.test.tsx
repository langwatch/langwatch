/**
 * @vitest-environment jsdom
 *
 * Regression tests for issue #2477: code agents must be supported as
 * suite targets alongside http agents, while unsupported agent types
 * (signature, workflow) must still be excluded from availableTargets.
 *
 * The set of allowed agent target types is derived from
 * `suiteAgentTargetTypes` (see `~/server/suites/types`), so these tests
 * pin the current contract: http + code in, everything else out.
 */

import { renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useSuiteForm } from "../useSuiteForm";

const baseParams = {
  suite: null,
  isOpen: true,
  suiteId: undefined,
  scenarios: [{ id: "scen_1", name: "Happy path", labels: [] }],
  prompts: [],
};

describe("useSuiteForm() — agent type filtering for availableTargets", () => {
  describe("given agents of mixed types returned from the API", () => {
    const mixedAgents = [
      { id: "agent_http", name: "HTTP Agent", type: "http" as const },
      { id: "agent_code", name: "Code Agent", type: "code" as const },
      { id: "agent_sig", name: "Signature Agent", type: "signature" as const },
      { id: "agent_wf", name: "Workflow Agent", type: "workflow" as const },
    ];

    describe("when availableTargets is derived", () => {
      it("includes the http agent", () => {
        const { result } = renderHook(() =>
          useSuiteForm({ ...baseParams, agents: mixedAgents }),
        );

        const httpTargets = result.current.availableTargets.filter(
          (t) => t.type === "http",
        );

        expect(httpTargets).toHaveLength(1);
        expect(httpTargets[0]?.referenceId).toBe("agent_http");
      });

      it("includes the code agent", () => {
        const { result } = renderHook(() =>
          useSuiteForm({ ...baseParams, agents: mixedAgents }),
        );

        const codeTargets = result.current.availableTargets.filter(
          (t) => t.type === "code",
        );

        expect(codeTargets).toHaveLength(1);
        expect(codeTargets[0]?.referenceId).toBe("agent_code");
      });

      it("excludes the signature agent", () => {
        const { result } = renderHook(() =>
          useSuiteForm({ ...baseParams, agents: mixedAgents }),
        );

        const referenceIds = result.current.availableTargets.map(
          (t) => t.referenceId,
        );

        expect(referenceIds).not.toContain("agent_sig");
      });

      it("excludes the workflow agent", () => {
        const { result } = renderHook(() =>
          useSuiteForm({ ...baseParams, agents: mixedAgents }),
        );

        const referenceIds = result.current.availableTargets.map(
          (t) => t.referenceId,
        );

        expect(referenceIds).not.toContain("agent_wf");
      });
    });
  });

  describe("given only code agents returned from the API", () => {
    const codeOnlyAgents = [
      { id: "agent_code_1", name: "Code Agent 1", type: "code" as const },
      { id: "agent_code_2", name: "Code Agent 2", type: "code" as const },
    ];

    describe("when availableTargets is derived", () => {
      it("includes all code agents as targets", () => {
        const { result } = renderHook(() =>
          useSuiteForm({ ...baseParams, agents: codeOnlyAgents }),
        );

        const codeTargets = result.current.availableTargets.filter(
          (t) => t.type === "code",
        );

        expect(codeTargets).toHaveLength(2);
        expect(codeTargets.map((t) => t.referenceId)).toEqual([
          "agent_code_1",
          "agent_code_2",
        ]);
      });
    });
  });

  describe("given only http agents returned from the API", () => {
    const httpOnlyAgents = [
      { id: "agent_http_1", name: "HTTP Agent 1", type: "http" as const },
      { id: "agent_http_2", name: "HTTP Agent 2", type: "http" as const },
    ];

    describe("when availableTargets is derived", () => {
      it("includes all http agents as targets", () => {
        const { result } = renderHook(() =>
          useSuiteForm({ ...baseParams, agents: httpOnlyAgents }),
        );

        const httpTargets = result.current.availableTargets.filter(
          (t) => t.type === "http",
        );

        expect(httpTargets).toHaveLength(2);
        expect(httpTargets.map((t) => t.referenceId)).toEqual([
          "agent_http_1",
          "agent_http_2",
        ]);
      });
    });
  });
});
