import "@testing-library/jest-dom/vitest";

// @vitest-environment jsdom
/**
 * The picker that adds a column to an evaluation.
 *
 * PORTED WITH THE DRAWER from
 * `platform/app/src/components/targets/__tests__/TargetTypeSelectorDrawer.test.tsx`,
 * whose subject was deleted in `cc91631cd8` while both openers — the
 * Evaluations table's "+" and the Run Evaluation button — kept writing the
 * address. The single mock that named a platform module now names
 * `@langwatch/ui-drawer`; the router mock is gone, because nothing in the
 * drawer reaches a router any more.
 *
 * TWO CARDS THE ORIGINAL NEVER COVERED are covered here — comparison and
 * evaluator — because the comparison card is the one whose navigation differs
 * from the other three, and an untested difference is what drifts.
 *
 * @see specs/experiments-v3/target-type-selector.feature
 */

import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockCloseDrawer = vi.fn();
const mockOpenDrawer = vi.fn();
const mockGoBack = vi.fn();

vi.mock("@langwatch/ui-drawer", () => ({
  useDrawer: () => ({
    closeDrawer: mockCloseDrawer,
    openDrawer: mockOpenDrawer,
    canGoBack: false,
    goBack: mockGoBack,
  }),
  getComplexProps: () => ({}),
}));

import { COMPARISON_EVALUATOR_TYPE } from "../../../../model/experiments-v3/types";
import { TargetTypeSelectorDrawer } from "../target-type-selector-drawer";

const Wrapper = ({ children }: { children: React.ReactNode }) => (
  <ChakraProvider value={defaultSystem}>{children}</ChakraProvider>
);

const renderDrawer = (props: Partial<React.ComponentProps<typeof TargetTypeSelectorDrawer>> = {}) =>
  render(<TargetTypeSelectorDrawer open={true} {...props} />, { wrapper: Wrapper });

const clickCard = async (type: string) => {
  const user = userEvent.setup();
  await waitFor(() => {
    expect(screen.getByTestId(`target-type-${type}`)).toBeInTheDocument();
  });
  await user.click(screen.getByTestId(`target-type-${type}`));
};

describe("given the picker that adds a column to an evaluation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  describe("when it opens", () => {
    it("names itself for what it does", async () => {
      renderDrawer();
      await waitFor(() => {
        expect(screen.getByText("Add to Evaluation")).toBeInTheDocument();
      });
    });

    /** @scenario "The picker offers every kind of column an evaluation can hold" */
    it("offers a prompt, an agent, a comparison and an evaluator", async () => {
      renderDrawer();
      await waitFor(() => {
        expect(screen.getByTestId("target-type-prompt")).toBeInTheDocument();
        expect(screen.getByTestId("target-type-agent")).toBeInTheDocument();
        expect(screen.getByTestId("target-type-comparison")).toBeInTheDocument();
        expect(screen.getByTestId("target-type-evaluator")).toBeInTheDocument();
      });
    });

    /** @scenario "The picker offers every kind of column an evaluation can hold" */
    it("describes each card by what it evaluates", async () => {
      renderDrawer();
      await waitFor(() => {
        expect(screen.getByText("Select versioned prompt or create a new one")).toBeInTheDocument();
        expect(
          screen.getByText("Integrate with your existing agent or create a workflow"),
        ).toBeInTheDocument();
        expect(
          screen.getByText("Pairwise or multi-candidate preference judging"),
        ).toBeInTheDocument();
        expect(screen.getByText("Test an evaluator against a dataset")).toBeInTheDocument();
      });
    });
  });

  describe("when a card is chosen and the run handles the choice itself", () => {
    /** @scenario "A caller that handles the choice itself is told what was picked" */
    it("tells the run a prompt was chosen", async () => {
      const onSelect = vi.fn();
      renderDrawer({ onSelect });

      await clickCard("prompt");

      expect(onSelect).toHaveBeenCalledWith("prompt");
    });

    /** @scenario "A caller that handles the choice itself is told what was picked" */
    it("tells the run an agent was chosen", async () => {
      const onSelect = vi.fn();
      renderDrawer({ onSelect });

      await clickCard("agent");

      expect(onSelect).toHaveBeenCalledWith("agent");
    });
  });

  describe("when a card is chosen and the picker navigates", () => {
    /** @scenario "Choosing a prompt goes to the prompt library" */
    it("replaces itself with the prompt library", async () => {
      renderDrawer();

      await clickCard("prompt");

      expect(mockOpenDrawer).toHaveBeenCalledWith("promptList", {}, { replace: true });
    });

    /** @scenario "Choosing an agent goes to the agent list" */
    it("replaces itself with the agent list", async () => {
      renderDrawer();

      await clickCard("agent");

      expect(mockOpenDrawer).toHaveBeenCalledWith("agentList", {}, { replace: true });
    });

    /** @scenario "Choosing an evaluator goes to the evaluator list" */
    it("replaces itself with the evaluator list", async () => {
      renderDrawer();

      await clickCard("evaluator");

      expect(mockOpenDrawer).toHaveBeenCalledWith("evaluatorList", {}, { replace: true });
    });

    /** @scenario "Choosing a comparison lists the comparisons I already have" */
    it("opens the evaluator list narrowed to comparisons, and stays behind it", async () => {
      renderDrawer();

      await clickCard("comparison");

      const [name, props, options] = mockOpenDrawer.mock.calls[0] ?? [];
      expect(name).toBe("evaluatorList");
      expect(props).toMatchObject({
        filterEvaluatorType: COMPARISON_EVALUATOR_TYPE,
        title: "Choose Comparison",
        createLabel: "New Comparison",
      });
      // No `replace`: the picker has to stay in the stack so the creation
      // form's back arrow lands on it rather than dead-ending.
      expect(options).toBeUndefined();
    });
  });

  describe("when the picker is cancelled", () => {
    /** @scenario "Cancelling adds nothing" */
    it("closes without opening anything else", async () => {
      const user = userEvent.setup();
      renderDrawer();

      await waitFor(() => {
        expect(screen.getByText("Cancel")).toBeInTheDocument();
      });
      await user.click(screen.getByText("Cancel"));

      expect(mockCloseDrawer).toHaveBeenCalled();
      expect(mockOpenDrawer).not.toHaveBeenCalled();
    });
  });
});
