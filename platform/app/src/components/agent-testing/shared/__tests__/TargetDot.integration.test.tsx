/**
 * @vitest-environment jsdom
 *
 * The mark of one target: its dot, and the label beside it.
 *
 * @see specs/features/agent-testing/comparison-mode.feature
 */

import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { TargetLegend } from "../TargetDot";

const Wrapper = ({ children }: { children: ReactNode }) => (
  <ChakraProvider value={defaultSystem}>{children}</ChakraProvider>
);

const LONG_LABEL = "support-agent · development (Ana), model=gpt-5-mini";

describe("<TargetLegend />", () => {
  afterEach(cleanup);

  describe("given a long label in a column header", () => {
    /** @scenario "A long target name keeps its own column" */
    it("reads the whole label and wraps rather than cutting it", () => {
      render(<TargetLegend color="#3b82f6" label={LONG_LABEL} wrap />, {
        wrapper: Wrapper,
      });
      const wrapped = screen.getByText(LONG_LABEL);
      expect(wrapped.textContent).toBe(LONG_LABEL);
      const wrappedClass = wrapped.className;
      cleanup();

      render(<TargetLegend color="#3b82f6" label={LONG_LABEL} />, {
        wrapper: Wrapper,
      });

      expect(screen.getByText(LONG_LABEL).className).not.toEqual(wrappedClass);
    });
  });
});
