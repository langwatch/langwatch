/**
 * An agent target's drawer reopened from its address after a reload keeps writing to its target.
 * @vitest-environment jsdom
 * Spec: modules/agent/specs/agent-versioning.feature
 */
import { cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { TargetConfig } from "../../../model/experiments-v3/types.ts";
import type * as OpenTargetEditor from "../use-open-target-editor.ts";

const drawer = vi.hoisted(() => ({
  current: undefined as string | undefined,
  params: {} as Record<string, string | undefined>,
  flowCallbacks: {} as Record<string, Record<string, (...args: never[]) => unknown>>,
  complexProps: [] as Record<string, unknown>[],
}));

vi.mock("@langwatch/browser-host/drawer", () => ({
  useDrawer: () => ({ openDrawer: vi.fn(), closeDrawer: vi.fn(), currentDrawer: drawer.current }),
  useDrawerParams: () => drawer.params,
  getFlowCallbacks: (name: string) => drawer.flowCallbacks[name],
  setFlowCallbacks: (name: string, callbacks: Record<string, (...args: never[]) => unknown>) => {
    drawer.flowCallbacks[name] = { ...drawer.flowCallbacks[name], ...callbacks };
  },
  setComplexProps: (props: Record<string, unknown>) => drawer.complexProps.push(props),
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

vi.mock("../use-open-target-editor.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof OpenTargetEditor>()),
  useOpenTargetEditor: () => ({
    openTargetEditor: vi.fn(),
    buildAvailableSources: () => [],
    isDatasetSource: () => false,
  }),
}));

vi.mock("../use-open-evaluator-editor.ts", () => ({
  useOpenEvaluatorEditor: () => vi.fn(),
}));

const { useEvaluationsV3Store } = await import("../use-evaluations-v3-store.ts");
const { useWorkbenchAddTargetFlow, useWorkbenchTargetSelection } =
  await import("../use-workbench-target-flow.ts");

const httpTarget: TargetConfig = {
  id: "target_http",
  type: "agent",
  agentType: "http",
  dbAgentId: "agent_http",
  agentLabel: "production",
  inputs: [{ identifier: "input", type: "str" }],
  outputs: [{ identifier: "output", type: "str" }],
  mappings: {},
};

function renderReloadedWorkbench() {
  return renderHook(() => useWorkbenchAddTargetFlow(useWorkbenchTargetSelection()));
}

describe("given the agent drawer of a pinned target reopened from its address", () => {
  beforeEach(() => {
    drawer.current = "agentHttpEditor";
    drawer.params = { targetId: "target_http", agentId: "agent_http", agentLabel: "production" };
    drawer.flowCallbacks = {};
    drawer.complexProps = [];
    useEvaluationsV3Store.getState().reset();
    useEvaluationsV3Store.setState({ experimentId: "experiment_1" });
    useEvaluationsV3Store.getState().addTarget(httpTarget);
  });

  afterEach(() => cleanup());

  /** @scenario "A target pinned to a label opens its agent drawer on that label" */
  it("re-wires the label writer, so a change after the reload updates the target", () => {
    renderReloadedWorkbench();

    const onAgentLabelChange = drawer.flowCallbacks.agentHttpEditor?.onAgentLabelChange as
      | ((label: string | undefined) => void)
      | undefined;
    expect(onAgentLabelChange).toBeDefined();
    onAgentLabelChange?.("staging");

    const target = useEvaluationsV3Store.getState().targets.find((row) => row.id === "target_http");
    expect(target?.agentLabel).toBe("staging");
    expect(drawer.complexProps).toMatchObject([
      { availableSources: [], inputMappings: { input: { sourceId: "test-data" } } },
    ]);
  });

  it("leaves a drawer the opener already wired alone", () => {
    const opened = vi.fn();
    drawer.flowCallbacks.agentHttpEditor = { onAgentLabelChange: opened };

    renderReloadedWorkbench();

    expect(drawer.flowCallbacks.agentHttpEditor?.onAgentLabelChange).toBe(opened);
    expect(drawer.complexProps).toEqual([]);
  });
});
