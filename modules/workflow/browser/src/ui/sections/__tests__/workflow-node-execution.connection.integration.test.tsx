/**
 * @vitest-environment jsdom
 */
import { renderWithDesignSystem } from "@langwatch/design-system/testing";
import type { Component } from "@langwatch/workflow-contract";
import { act, cleanup, screen } from "@testing-library/react";
import type { Node } from "@xyflow/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { _useWorkflowStore } from "../../../behavior/use-workflow-store.ts";
import type { SocketStatus } from "../../../behavior/workflow-store.ts";
import { WorkflowNodeHostProvider } from "../../elements/workflow-node.host.tsx";
import { ComponentExecutionButton } from "../workflow-node-execution.tsx";

const { toastCreate } = vi.hoisted(() => ({ toastCreate: vi.fn() }));
vi.mock("@langwatch/browser-host/toaster", () => ({ toaster: { create: toastCreate } }));

const node = {
  id: "llm-1",
  type: "signature",
  position: { x: 0, y: 0 },
  data: { name: "LLM" },
} as Node<Component>;

const host = {
  ComponentIcon: () => null,
  LLMModelDisplay: () => null,
  HoverableBigText: ({ children }: { children: ReactNode }) => <>{children}</>,
  useColorModeValue: (light: string) => light,
  useComponentExecution: () => ({
    startComponentExecution: vi.fn(),
    stopComponentExecution: vi.fn(),
  }),
  useComponentVersion: () => ({ currentVersion: null }),
  useEntryDatasetTotal: () => 0,
};

function renderButton({ socketStatus }: { socketStatus: SocketStatus }) {
  act(() => _useWorkflowStore.getState().setSocketStatus(socketStatus));
  renderWithDesignSystem(
    <WorkflowNodeHostProvider value={host}>
      <ComponentExecutionButton node={node} />
    </WorkflowNodeHostProvider>,
  );
  return screen.getByTestId("workflow-node-run-menu");
}

describe("ComponentExecutionButton", () => {
  afterEach(cleanup);

  describe("given the engine connection is not up", () => {
    /** @scenario Run waits for the engine connection */
    it("disables run, without a toast", () => {
      const run = renderButton({ socketStatus: "connecting-python" });

      expect(run).toBeDisabled();
      expect(toastCreate).not.toHaveBeenCalled();
    });
  });

  describe("given the engine connection is up", () => {
    it("enables run", () => {
      expect(renderButton({ socketStatus: "connected" })).not.toBeDisabled();
    });
  });
});
