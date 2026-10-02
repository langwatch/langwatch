/**
 * Prompt column's "Optimize" menu hands it to Langy with picked context and
 * auto-sent ask.
 * @vitest-environment jsdom
 * @see specs/langy/langy-prompt-optimization-entrypoints.feature
 */
import { renderWithDesignSystem } from "@langwatch/design-system/testing";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@langwatch/browser-host/use-organization-team-project", () => ({
  useOrganizationTeamProject: () => ({
    project: { id: "project_1", slug: "proj" },
  }),
}));

vi.mock("../../experiment-api.ts", () => ({
  experimentApi: {
    useUtils: () => ({}),
    useQueries: () => [],
    agents: { getById: { useQuery: () => ({ data: null, isLoading: false }) } },
  },
}));
vi.mock("@langwatch/prompt-client", () => ({
  promptClient: {
    useUtils: () => ({}),
    prompts: {
      getByIdOrHandle: {
        useQuery: () => ({ data: { name: "Support draft" }, isLoading: false }),
      },
    },
  },
}));

vi.mock("@langwatch/evaluator-client", () => ({
  evaluatorClient: {
    useUtils: () => ({}),
    evaluators: {
      getById: { useQuery: () => ({ data: null, isLoading: false }) },
    },
  },
}));

const flagEnabled = vi.hoisted(() => ({ value: true }));
vi.mock("@langwatch/browser-host/feature-flag", () => ({
  useFeatureFlag: () => ({ enabled: flagEnabled.value }),
}));

import { defineSlice } from "@langwatch/browser-host/global-store";
import {
  LANGY_ABSENT_CONTEXT_TARGET,
  LANGY_ABSENT_SURFACE,
  LANGY_CONTEXT_TARGET_SLICE,
  LANGY_STORE_SLICE,
  type LangyContextTargetState,
  type LangySliceSurface,
} from "@langwatch/langy-contract";

// Stand in for Langy, the owner of both slices, which this package only reads.
const langy = defineSlice<LangySliceSurface>({
  name: LANGY_STORE_SLICE,
  create: (set, get) => ({
    ...LANGY_ABSENT_SURFACE,
    askLangy: (prompt) => set({ isOpen: true, pendingPrompt: prompt }),
    chooseChip: (id) => set({ chosenChipIds: new Set(get().chosenChipIds).add(id) }),
  }),
});
const targets = defineSlice<LangyContextTargetState>({
  name: LANGY_CONTEXT_TARGET_SLICE,
  create: (set, get) => ({
    ...LANGY_ABSENT_CONTEXT_TARGET,
    pick: (target) => set({ picked: [...get().picked, target] }),
  }),
});

import type { TargetConfig } from "../../../model/experiments-v3/types.ts";
import { TargetHeader } from "../../../ui/sections/experiments-v3/TargetSection/target-header.tsx";
import { useEvaluationsV3Store } from "../use-evaluations-v3-store.ts";
import { useOptimizeWithLangy } from "../use-optimize-with-langy.ts";

const promptTarget: TargetConfig = {
  id: "target-baseline",
  type: "prompt",
  promptId: "prompt_1",
  inputs: [],
  outputs: [],
  mappings: {},
};

/**
 * The header as the page builds it. The hook decides whether there is a
 * handler at all, so the menu item and the flag it hangs on are exercised
 * together rather than by handing the header a stub.
 */
function LangyWiredHeader({ target }: { target: TargetConfig }) {
  const onOptimize = useOptimizeWithLangy();
  return <TargetHeader target={target} onOptimize={onOptimize} />;
}

function renderHeader({ target }: { target: TargetConfig }) {
  return renderWithDesignSystem(<LangyWiredHeader target={target} />);
}

async function openMenu() {
  await userEvent.click(screen.getByTestId("target-header-button"));
}

beforeEach(() => {
  flagEnabled.value = true;
});
afterEach(cleanup);

describe("given a prompt column on the workbench", () => {
  describe("when the column menu opens", () => {
    /** @scenario The prompt column menu offers Optimize this prompt on prompt targets only */
    it("offers Optimize this prompt as the first item", async () => {
      renderHeader({ target: promptTarget });
      await openMenu();

      const item = await screen.findByTestId("target-optimize-menu-item");
      expect(item.textContent).toContain("Optimize this prompt");
    });

    /** @scenario The prompt column menu offers Optimize this prompt on prompt targets only */
    it("offers nothing on an evaluator column", async () => {
      renderHeader({
        target: {
          id: "target-eval",
          type: "evaluator",
          targetEvaluatorId: "eval_1",
          inputs: [],
          outputs: [],
          mappings: {},
        },
      });
      await openMenu();
      await screen.findByRole("menuitem", { name: /Duplicate/ });

      expect(screen.queryByTestId("target-optimize-menu-item")).toBeNull();
    });

    it("offers nothing while the channel is flagged off", async () => {
      flagEnabled.value = false;
      renderHeader({ target: promptTarget });
      await openMenu();
      await screen.findByRole("menuitem", { name: /Duplicate/ });

      expect(screen.queryByTestId("target-optimize-menu-item")).toBeNull();
    });
  });
});

describe("given the optimize handoff", () => {
  beforeEach(() => {
    langy.setState({
      isOpen: false,
      pendingPrompt: null,
      chosenChipIds: new Set<string>(),
    });
    targets.setState({ picked: [] });
    useEvaluationsV3Store.getState().reset();
    useEvaluationsV3Store.getState().setExperimentSlug("support-quality");
  });

  function Harness() {
    const optimize = useOptimizeWithLangy();
    return (
      <button
        type="button"
        onClick={() => optimize?.({ target: promptTarget, name: "Support draft" })}
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

      const state = langy.getState();
      expect(state.isOpen).toBe(true);
      expect(state.pendingPrompt).toBe(
        'Optimize the prompt in the "Support draft" column. Keep that column unchanged as the baseline and work on a duplicate.',
      );
    });

    /** @scenario The optimize handoff carries the experiment and prompt context chips */
    it("chooses the experiment chip and absorbs the prompt", () => {
      render(<Harness />);
      fireEvent.click(screen.getByText("go"));

      expect(langy.getState().chosenChipIds.has("experiment:support-quality")).toBe(true);
      const picked = targets.getState().picked;
      expect(picked.some((chip) => chip.id === "prompt:prompt_1")).toBe(true);
    });

    it("stays hidden while the channel is flagged off", () => {
      flagEnabled.value = false;
      render(<Harness />);

      expect(screen.getByText("go")).toBeDefined();
      fireEvent.click(screen.getByText("go"));
      expect(langy.getState().pendingPrompt).toBeNull();
    });
  });
});
