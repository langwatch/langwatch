/** @vitest-environment jsdom */
import { render, renderHook } from "@testing-library/react";
import { Position, type EdgeProps } from "@xyflow/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

import { WorkflowEdge } from "../../sections/workflow-edge.tsx";
import { useWorkflowNodeHost, WorkflowNodeHostProvider } from "../workflow-node.host.tsx";

type NodeHost = Parameters<typeof WorkflowNodeHostProvider>[0]["value"];

function hostWith(overrides: Partial<NonNullable<NodeHost>> = {}): NonNullable<NodeHost> {
  return {
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
    ...overrides,
  };
}

const edgeProps: EdgeProps = {
  id: "edge-1",
  source: "a",
  target: "b",
  sourceX: 0,
  sourceY: 0,
  targetX: 40,
  targetY: 40,
  sourcePosition: Position.Right,
  targetPosition: Position.Left,
  selected: false,
};

describe("the Workflow node host port", () => {
  describe("when a renderer reads it with no application behind it", () => {
    /** @scenario "Canvas node renderers use explicit application host ports" */
    it("refuses rather than reaching for application code itself", () => {
      const quiet = vi.spyOn(console, "error").mockImplementation(() => undefined);

      expect(() => renderHook(() => useWorkflowNodeHost())).toThrow(
        "Workflow node renderers require a WorkflowNodeHostProvider",
      );
      quiet.mockRestore();
    });
  });

  describe("when the application injects the port", () => {
    /** @scenario "Canvas node renderers use explicit application host ports" */
    it("hands renderers exactly the dataset total the application supplied", () => {
      const useEntryDatasetTotal = vi.fn(() => 42);
      const host = hostWith({ useEntryDatasetTotal });

      const { result } = renderHook(() => useWorkflowNodeHost(), {
        wrapper: ({ children }) => (
          <WorkflowNodeHostProvider value={host}>{children}</WorkflowNodeHostProvider>
        ),
      });

      expect(result.current).toBe(host);
      expect(result.current.useEntryDatasetTotal(undefined)).toBe(42);
    });

    it("draws ordinary and selected edges with semantic colours", () => {
      const { container, rerender } = render(
        <svg>
          <WorkflowEdge {...edgeProps} />
        </svg>,
      );
      expect(container.querySelector("path")?.getAttribute("style")).toContain(
        "var(--chakra-colors-border)",
      );
      rerender(
        <svg>
          <WorkflowEdge {...edgeProps} selected />
        </svg>,
      );
      expect(container.querySelector("path")?.getAttribute("style")).toContain(
        "var(--chakra-colors-blue-focus-ring)",
      );
    });
  });
});
