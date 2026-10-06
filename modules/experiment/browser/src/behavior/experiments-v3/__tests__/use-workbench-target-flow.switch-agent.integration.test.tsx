/**
 * @vitest-environment jsdom
 * @see specs/agents/workflow-agent-as-target.feature
 */
import type { AgentWithFields } from "@langwatch/agent-contract";
import type { WireOf } from "@langwatch/api/web";
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { TargetConfig } from "../../../model/experiments-v3/types.ts";

const drawer = vi.hoisted(() => ({
  openDrawer: vi.fn(),
  closeDrawer: vi.fn(),
  flowCallbacks: {} as Record<string, Record<string, (...args: never[]) => unknown>>,
}));

vi.mock("@langwatch/browser-host/drawer", () => ({
  useDrawer: () => ({
    openDrawer: drawer.openDrawer,
    closeDrawer: drawer.closeDrawer,
    currentDrawer: undefined,
  }),
  useDrawerParams: () => ({}),
  getFlowCallbacks: (name: string) => drawer.flowCallbacks[name],
  setFlowCallbacks: (name: string, callbacks: Record<string, (...args: never[]) => unknown>) => {
    drawer.flowCallbacks[name] = { ...drawer.flowCallbacks[name], ...callbacks };
  },
  setComplexProps: vi.fn(),
}));

vi.mock("@langwatch/browser-host/use-organization-team-project", () => ({
  useOrganizationTeamProject: () => ({ project: { id: "test-project", slug: "test-project" } }),
}));

vi.mock("@langwatch/evaluator-client", () => ({
  evaluatorClient: { useUtils: () => ({ evaluators: { getById: { fetch: vi.fn() } } }) },
}));

vi.mock("../../experiment-api.ts", () => ({
  experimentApi: { useUtils: () => ({ agents: { getById: { fetch: vi.fn() } } }) },
}));

vi.mock("../use-open-target-editor.ts", () => ({
  scrollToTargetColumn: vi.fn(),
  useOpenTargetEditor: () => ({
    openTargetEditor: vi.fn(),
    buildAvailableSources: () => [],
    isDatasetSource: () => false,
  }),
}));

vi.mock("../use-open-evaluator-editor.ts", () => ({
  useOpenEvaluatorEditor: () => vi.fn(),
}));

import { useEvaluationsV3Store } from "../use-evaluations-v3-store.ts";
import {
  useWorkbenchAddTargetFlow,
  useWorkbenchTargetSelection,
} from "../use-workbench-target-flow.ts";

const savedAgent = (overrides: Partial<WireOf<AgentWithFields>>): WireOf<AgentWithFields> =>
  ({
    id: "agent_other",
    name: "Other agent",
    type: "http",
    config: { url: "https://agent.invalid", bodyTemplate: "{}" },
    inputFields: [{ identifier: "input", type: "str" }],
    outputFields: [{ identifier: "output", type: "str" }],
    fieldsResolved: true,
    ...overrides,
  }) as WireOf<AgentWithFields>;

const workflowTarget: TargetConfig = {
  id: "target_workflow",
  type: "agent",
  agentType: "workflow",
  dbAgentId: "agent_workflow",
  inputs: [{ identifier: "question", type: "str" }],
  outputs: [{ identifier: "output", type: "str" }],
  mappings: {},
};

function renderTargetFlow() {
  return renderHook(() => {
    const selection = useWorkbenchTargetSelection();
    return useWorkbenchAddTargetFlow(selection);
  });
}

describe("given a workflow agent added as a target", () => {
  beforeEach(() => {
    drawer.openDrawer.mockClear();
    drawer.closeDrawer.mockClear();
    drawer.flowCallbacks = {};
    useEvaluationsV3Store.getState().reset();
    useEvaluationsV3Store.getState().addTarget(workflowTarget);
  });

  afterEach(() => {
    cleanup();
  });

  describe("when the user switches the target to a different agent", () => {
    /** @scenario "Switching away from a workflow target" */
    it("replaces the workflow column with the newly selected agent", () => {
      const { result } = renderTargetFlow();

      act(() => result.current.handleSwitchTarget(workflowTarget));
      expect(drawer.openDrawer).toHaveBeenCalledWith("agentList");

      act(() => {
        drawer.flowCallbacks.agentList?.onSelect?.(savedAgent({}) as never);
      });

      const targets = useEvaluationsV3Store.getState().targets;
      expect(targets.map((target) => target.id)).not.toContain("target_workflow");
      expect(targets).toHaveLength(1);
      expect(targets[0]).toMatchObject({
        type: "agent",
        agentType: "http",
        dbAgentId: "agent_other",
      });
      expect(drawer.closeDrawer).toHaveBeenCalled();
    });
  });
});
