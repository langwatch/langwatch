/**
 * @vitest-environment jsdom
 */
import { renderWithDesignSystem } from "@langwatch/design-system/testing";
import { cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { type BatchTargetOutput } from "../../batch-evaluation-results.types.ts";
import { BatchTargetCell } from "../batch-target-cell.tsx";

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

      const { rerender } = renderWithDesignSystem(
        <BatchTargetCell targetOutput={targetOutput({ output: "first answer" })} />,
      );
      rerender(<BatchTargetCell targetOutput={targetOutput({ output: "second answer" })} />);

      fireEvent.click(screen.getByTestId("copy-output-target-1"));

      expect(writeText).toHaveBeenCalledWith("second answer");
    });
  });
});
