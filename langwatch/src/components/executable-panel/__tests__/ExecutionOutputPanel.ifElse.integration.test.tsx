/**
 * @vitest-environment jsdom
 *
 * The If/Else node emits both branch handles (true/false) for routing, but
 * the results panel must surface a single condition result, not two boxes
 * that read as a contradiction ("FALSE: true").
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("~/utils/compat/next-router", () => {
  const router = {
    query: {},
    asPath: "/p/workflows/wf",
    push: vi.fn(),
    replace: vi.fn(),
  };
  return { default: router, useRouter: () => router };
});

// Field redaction reads a tRPC query; keep the real RenderInputOutput but
// let it render the value rather than the redaction skeleton.
vi.mock("~/hooks/useFieldRedaction", () => ({
  useFieldRedaction: () => ({ isRedacted: false, isLoading: false }),
}));

import type { ExecutionState } from "~/optimization_studio/types/dsl";
import { ExecutionOutputPanel } from "../ExecutionOutputPanel";

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
    describe("when the panel renders its outputs", () => {
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
        // A single output box, not the two true/false boxes.
        expect(container.querySelectorAll("pre")).toHaveLength(1);
        const box = container.querySelector("pre");
        expect(box?.textContent).toContain("false");
        expect(box?.textContent).not.toContain("true");
      });
    });
  });

  describe("given an if/else run whose condition was true", () => {
    describe("when the panel renders its outputs", () => {
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
  });

  describe("given an if/else run that completed in under a millisecond", () => {
    describe("when the panel renders its metadata", () => {
      /** @scenario A sub-millisecond run still shows its duration */
      it("shows a 0ms duration instead of hiding the timing line", () => {
        const zeroDuration = {
          status: "success",
          // started_at === finished_at: a real sub-millisecond if/else run.
          timestamps: { started_at: 1700000000000, finished_at: 1700000000000 },
          outputs: { true: false, false: true },
        } as unknown as ExecutionState;

        render(
          <ExecutionOutputPanel
            executionState={zeroDuration}
            nodeType="if_else"
          />,
          { wrapper: Wrapper },
        );

        expect(screen.getByText("0ms")).toBeInTheDocument();
      });
    });
  });

  describe("given a non if/else node", () => {
    describe("when the panel renders its outputs", () => {
      it("still renders each named output", () => {
        const { container } = render(
          <ExecutionOutputPanel
            executionState={successState({ answer: "hello" })}
            nodeType="code"
          />,
          { wrapper: Wrapper },
        );

        expect(screen.getByText("answer")).toBeInTheDocument();
        expect(container.querySelectorAll("pre")).toHaveLength(1);
        expect(container.querySelector("pre")?.textContent).toContain("hello");
      });
    });
  });
});
