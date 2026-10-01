/**
 * @vitest-environment jsdom
 */
import { renderWithDesignSystem } from "@langwatch/design-system/testing";
import type { ExecutionState } from "@langwatch/workflow-contract";
import { cleanup, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../../behavior/use-field-redaction.ts", () => ({
  useFieldRedaction: () => ({ isRedacted: false, isLoading: false }),
}));

vi.mock("../../../../behavior/lent-trace.tsx", () => ({
  RenderInputOutput: ({ value }: { value: unknown }) => (
    <span>{typeof value === "string" ? value : JSON.stringify(value)}</span>
  ),
}));

vi.mock("@langwatch/browser-host/use-drawer", () => ({
  useDrawer: () => ({ openDrawer: vi.fn() }),
}));

import { ExecutionOutputPanel } from "../execution-output-panel.tsx";

const successState = (outputs: Record<string, unknown>): ExecutionState => ({
  status: "success",
  timestamps: { started_at: 1000, finished_at: 1016 },
  outputs,
});

describe("ExecutionOutputPanel - if/else outputs", () => {
  afterEach(() => cleanup());

  describe("given an if/else run whose condition was false", () => {
    /** @scenario The if/else result shows a single condition value */
    it("shows one Condition box of false, not both branch handles", () => {
      const { container } = renderWithDesignSystem(
        <ExecutionOutputPanel
          executionState={successState({ true: false, false: true })}
          nodeType="if_else"
        />,
      );

      expect(screen.getByText("Condition")).toBeInTheDocument();
      expect(container.querySelectorAll("pre")).toHaveLength(1);
      const box = container.querySelector("pre");
      expect(box?.textContent).toContain("false");
      expect(box?.textContent).not.toContain("true");
    });
  });

  describe("given an if/else run whose condition was true", () => {
    /** @scenario The if/else result shows a single condition value */
    it("shows one Condition box of true", () => {
      const { container } = renderWithDesignSystem(
        <ExecutionOutputPanel
          executionState={successState({ true: true, false: false })}
          nodeType="if_else"
        />,
      );

      expect(screen.getByText("Condition")).toBeInTheDocument();
      expect(container.querySelectorAll("pre")).toHaveLength(1);
      expect(container.querySelector("pre")?.textContent).toContain("true");
    });
  });

  describe("given an if/else run that completed in under a millisecond", () => {
    /** @scenario A sub-millisecond run still shows its duration */
    it("shows a 0ms duration instead of hiding the timing line", () => {
      const zeroDuration: ExecutionState = {
        status: "success",
        timestamps: { started_at: 1700000000000, finished_at: 1700000000000 },
        outputs: { true: false, false: true },
      };

      renderWithDesignSystem(
        <ExecutionOutputPanel executionState={zeroDuration} nodeType="if_else" />,
      );

      expect(screen.getByText("0ms")).toBeInTheDocument();
    });
  });

  describe("given a non if/else node", () => {
    it("still renders each named output", () => {
      const { container } = renderWithDesignSystem(
        <ExecutionOutputPanel executionState={successState({ answer: "hello" })} nodeType="code" />,
      );

      expect(screen.getByText("answer")).toBeInTheDocument();
      expect(container.querySelectorAll("pre")).toHaveLength(1);
      expect(container.querySelector("pre")?.textContent).toContain("hello");
    });
  });
});
