/**
 * @vitest-environment jsdom
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { type BatchTargetOutput, BatchTargetCell } from "@langwatch/experiment-browser-kit";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

const Wrapper = ({ children }: { children: ReactNode }) => (
  <ChakraProvider value={defaultSystem}>{children}</ChakraProvider>
);

const targetOutput = (output: Record<string, unknown>): BatchTargetOutput => ({
  targetId: "target-1",
  output,
  cost: null,
  duration: null,
  error: null,
  traceId: null,
  evaluatorResults: [],
});

afterEach(() => {
  cleanup();
});

describe("given a cell whose output changed after it first rendered", () => {
  describe("when the output is copied", () => {
    it("copies the output on screen, not the first one", () => {
      const writeText = vi.fn().mockResolvedValue(void 0);
      Object.defineProperty(navigator, "clipboard", {
        value: { writeText },
        configurable: true,
      });

      const { rerender } = render(
        <BatchTargetCell targetOutput={targetOutput({ output: "first answer" })} />,
        { wrapper: Wrapper },
      );
      rerender(<BatchTargetCell targetOutput={targetOutput({ output: "second answer" })} />);

      fireEvent.click(screen.getByTestId("copy-output-target-1"));

      expect(writeText).toHaveBeenCalledWith("second answer");
    });
  });
});
