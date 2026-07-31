/**
 * @vitest-environment jsdom
 *
 * A workflow-type agent target runs a whole Studio workflow, not a single
 * code node. Its column header has to say so at a glance, or the workbench
 * reads as if every agent were a code agent.
 *
 * @see specs/agents/workflow-agent-as-target.feature
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { TargetConfig } from "../../../types";
import { TargetHeader } from "../TargetHeader";

vi.mock("~/utils/compat/next-router", () => ({
  useRouter: () => ({
    query: { project: "test-project" },
    pathname: "/test",
    push: vi.fn(),
    replace: vi.fn(),
    events: { on: vi.fn(), off: vi.fn() },
  }),
}));

vi.mock("~/prompts/hooks/useLatestPromptVersion", () => ({
  useLatestPromptVersion: () => ({
    currentVersion: undefined,
    latestVersion: undefined,
    isOutdated: false,
    isLoading: false,
    nextVersion: undefined,
  }),
}));

vi.mock("../../../hooks/useTargetName", () => ({
  useTargetName: (target: { id: string }) => target.id,
  useTargetNames: (targets: ({ id: string } | undefined)[]) =>
    targets.map((target) => target?.id ?? ""),
}));

vi.mock("../../../hooks/useEvaluatorName", () => ({
  useEvaluatorName: () => "Exact Match",
  useEvaluatorNames: () => new Map(),
  useCodeEvaluatorIds: () => new Set(),
}));

const renderHeader = (target: TargetConfig) =>
  render(
    <ChakraProvider value={defaultSystem}>
      <TargetHeader target={target} onEdit={vi.fn()} onRemove={vi.fn()} />
    </ChakraProvider>,
  );

const workflowAgentTarget: TargetConfig = {
  id: "Pipeline Agent",
  type: "agent",
  agentType: "workflow",
  dbAgentId: "agent-workflow-1",
  inputs: [],
  outputs: [],
  mappings: {},
};

const codeAgentTarget: TargetConfig = {
  id: "Python Processor",
  type: "agent",
  agentType: "code",
  dbAgentId: "agent-code-1",
  inputs: [],
  outputs: [],
  mappings: {},
};

describe("<TargetHeader/> for a workflow agent", () => {
  afterEach(() => {
    cleanup();
  });

  describe("given a workflow-type agent added as a target", () => {
    describe("when the column header renders", () => {
      /** @scenario The target column shows a workflow icon */
      it("marks the column with the workflow icon rather than the code icon", () => {
        renderHeader(workflowAgentTarget);

        expect(screen.getByTestId("icon-workflow")).toBeInTheDocument();
        expect(screen.queryByTestId("icon-code")).not.toBeInTheDocument();
        expect(screen.getByText("Pipeline Agent")).toBeInTheDocument();
      });
    });
  });

  describe("given a code-type agent added as a target", () => {
    describe("when the column header renders", () => {
      it("keeps the code icon, so the two agent kinds stay distinguishable", () => {
        renderHeader(codeAgentTarget);

        expect(screen.getByTestId("icon-code")).toBeInTheDocument();
        expect(screen.queryByTestId("icon-workflow")).not.toBeInTheDocument();
      });
    });
  });

  describe("given a workflow attached directly as a target", () => {
    describe("when the column header renders", () => {
      it("uses the same workflow icon as a workflow-type agent", () => {
        renderHeader({
          id: "Support Pipeline",
          type: "workflow",
          workflowId: "workflow-1",
          inputs: [],
          outputs: [],
          mappings: {},
        } as TargetConfig);

        expect(screen.getByTestId("icon-workflow")).toBeInTheDocument();
        expect(screen.queryByTestId("icon-code")).not.toBeInTheDocument();
      });
    });
  });
});
