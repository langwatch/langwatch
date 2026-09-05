/**
 * @vitest-environment jsdom
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ExecutionState } from "@langwatch/workflow-contract";

vi.mock("../../../../behavior/use-field-redaction", () => ({
  useFieldRedaction: () => ({ isRedacted: false, isLoading: false }),
}));

vi.mock("@langwatch/ui-host/use-drawer", () => ({
  useDrawer: () => ({ openDrawer: vi.fn() }),
}));

import { ExecutionOutputPanel } from "../execution-output-panel";

const Wrapper = ({ children }: { children: React.ReactNode }) => (
  <ChakraProvider value={defaultSystem}>{children}</ChakraProvider>
);

const successState = (outputs: Record<string, unknown>) =>
  ({
    status: "success",
    timestamps: { started_at: 1000, finished_at: 1016 },
    outputs,
  }) as unknown as ExecutionState;

describe("ExecutionOutputPanel - if/else outputs", () => {
  afterEach(() => cleanup());

  describe("given an if/else run whose condition was false", () => {
    /** @scenario The if/else result shows a single condition value */
    it("shows one Condition box of false, not both branch handles", () => {
      const { container } = render(
        <ExecutionOutputPanel
          executionState={successState({ true: false, false: true })}
          nodeType="if_else"
        />,
        { wrapper: Wrapper },
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
      const { container } = render(
        <ExecutionOutputPanel
          executionState={successState({ true: true, false: false })}
          nodeType="if_else"
        />,
        { wrapper: Wrapper },
      );

      expect(screen.getByText("Condition")).toBeInTheDocument();
      expect(container.querySelectorAll("pre")).toHaveLength(1);
      expect(container.querySelector("pre")?.textContent).toContain("true");
    });
  });

  describe("given an if/else run that completed in under a millisecond", () => {
    /** @scenario A sub-millisecond run still shows its duration */
    it("shows a 0ms duration instead of hiding the timing line", () => {
      const zeroDuration = {
        status: "success",
        timestamps: { started_at: 1700000000000, finished_at: 1700000000000 },
        outputs: { true: false, false: true },
      } as unknown as ExecutionState;

      render(<ExecutionOutputPanel executionState={zeroDuration} nodeType="if_else" />, {
        wrapper: Wrapper,
      });

      expect(screen.getByText("0ms")).toBeInTheDocument();
    });
  });

  describe("given a non if/else node", () => {
    it("still renders each named output", () => {
      const { container } = render(
        <ExecutionOutputPanel executionState={successState({ answer: "hello" })} nodeType="code" />,
        { wrapper: Wrapper },
      );

      expect(screen.getByText("answer")).toBeInTheDocument();
      expect(container.querySelectorAll("pre")).toHaveLength(1);
      expect(container.querySelector("pre")?.textContent).toContain("hello");
    });
  });
});
