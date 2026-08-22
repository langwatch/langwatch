/**
 * @vitest-environment jsdom
 *
 * @see specs/langy/langy-prompt-optimization-entrypoints.feature
 *
 * The prompt column's menu offers "Optimize this prompt", and choosing it
 * hands the column to Langy: the experiment chip is chosen, the prompt is
 * absorbed as picked context, and the panel opens with an auto-sent ask.
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("~/hooks/useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: () => ({
    project: { id: "project_1", slug: "proj" },
  }),
}));

vi.mock("~/utils/api", () => ({
  api: {
    useUtils: () => ({}),
    useQueries: () => [],
    prompts: {
      getByIdOrHandle: {
        useQuery: () => ({ data: { name: "Support draft" }, isLoading: false }),
      },
    },
    agents: { getById: { useQuery: () => ({ data: null, isLoading: false }) } },
    evaluators: {
      getById: { useQuery: () => ({ data: null, isLoading: false }) },
    },
  },
}));

const flagEnabled = vi.hoisted(() => ({ value: true }));
vi.mock("~/hooks/useFeatureFlag", () => ({
  useFeatureFlag: () => ({ enabled: flagEnabled.value }),
}));

import { useLangyContextTargetStore } from "~/features/langy/stores/langyContextTargetStore";
import { useLangyStore } from "~/features/langy/stores/langyStore";
import { TargetHeader } from "../components/TargetSection/TargetHeader";
import { useEvaluationsV3Store } from "../hooks/useEvaluationsV3Store";
import { useOptimizeWithLangy } from "../hooks/useOptimizeWithLangy";
import type { TargetConfig } from "../types";

const promptTarget: TargetConfig = {
  id: "target-baseline",
  type: "prompt",
  promptId: "prompt_1",
  inputs: [],
  outputs: [],
  mappings: {},
};

function renderHeader(
  target: TargetConfig,
  onOptimize?: (target: TargetConfig, name: string) => void,
) {
  return render(
    <ChakraProvider value={defaultSystem}>
      <TargetHeader target={target} onOptimize={onOptimize} />
    </ChakraProvider>,
  );
}

async function openMenu() {
  await userEvent.click(screen.getByTestId("target-header-button"));
}

afterEach(cleanup);

describe("given a prompt column on the workbench", () => {
  describe("when the column menu opens", () => {
    /** @scenario The prompt column menu offers Optimize this prompt on prompt targets only */
    it("offers Optimize this prompt as the first item", async () => {
      renderHeader(promptTarget, vi.fn());
      await openMenu();

      const item = await screen.findByTestId("target-optimize-menu-item");
      expect(item.textContent).toContain("Optimize this prompt");
    });

    /** @scenario The prompt column menu offers Optimize this prompt on prompt targets only */
    it("offers nothing on an evaluator column", async () => {
      renderHeader(
        {
          id: "target-eval",
          type: "evaluator",
          targetEvaluatorId: "eval_1",
          inputs: [],
          outputs: [],
          mappings: {},
        },
        vi.fn(),
      );
      await openMenu();
      await screen.findByRole("menuitem", { name: /Duplicate/ });

      expect(screen.queryByTestId("target-optimize-menu-item")).toBeNull();
    });

    it("offers nothing while the channel is flagged off", async () => {
      renderHeader(promptTarget, undefined);
      await openMenu();
      await screen.findByRole("menuitem", { name: /Duplicate/ });

      expect(screen.queryByTestId("target-optimize-menu-item")).toBeNull();
    });
  });
});

describe("given the optimize handoff", () => {
  beforeEach(() => {
    flagEnabled.value = true;
    useLangyStore.setState({
      isOpen: false,
      pendingPrompt: null,
      chosenChipIds: new Set<string>(),
    });
    useLangyContextTargetStore.setState({ picked: [] });
    useEvaluationsV3Store.getState().reset();
    useEvaluationsV3Store.getState().setExperimentSlug("support-quality");
  });

  function Harness() {
    const optimize = useOptimizeWithLangy();
    return (
      <button
        type="button"
        onClick={() => optimize?.(promptTarget, "Support draft")}
      >
        go
      </button>
    );
  }

  describe("when the user chooses Optimize this prompt", () => {
    /** @scenario Choosing Optimize opens the Langy panel and auto-sends the optimize request */
    it("opens the panel with the ask queued to auto-send", () => {
      render(<Harness />);
      fireEvent.click(screen.getByText("go"));

      const state = useLangyStore.getState();
      expect(state.isOpen).toBe(true);
      expect(state.pendingPrompt).toBe(
        'Optimize the prompt in the "Support draft" column. Keep that column unchanged as the baseline and work on a duplicate.',
      );
    });

    /** @scenario The optimize handoff carries the experiment and prompt context chips */
    it("chooses the experiment chip and absorbs the prompt", () => {
      render(<Harness />);
      fireEvent.click(screen.getByText("go"));

      expect(
        useLangyStore
          .getState()
          .chosenChipIds.has("experiment:support-quality"),
      ).toBe(true);
      const picked = useLangyContextTargetStore.getState().picked;
      expect(picked.some((chip) => chip.id === "prompt:prompt_1")).toBe(true);
    });

    it("stays hidden while the channel is flagged off", () => {
      flagEnabled.value = false;
      render(<Harness />);

      expect(screen.getByText("go")).toBeDefined();
      fireEvent.click(screen.getByText("go"));
      expect(useLangyStore.getState().pendingPrompt).toBeNull();
    });
  });
});
