/** @vitest-environment jsdom */

import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useEvaluationsV3Store } from "../../../hooks/useEvaluationsV3Store";
import { useTargetName } from "../../../hooks/useTargetName";
import {
  createInitialResults,
  createInitialUIState,
  type TargetConfig,
} from "../../../types";
import { TargetHeader } from "../../TargetSection/TargetHeader";

// Mock next/router
vi.mock("~/utils/compat/next-router", () => ({
  useRouter: () => ({
    query: { project: "test-project" },
    pathname: "/test",
    push: vi.fn(),
    replace: vi.fn(),
    events: { on: vi.fn(), off: vi.fn() },
  }),
}));

// Mock useLatestPromptVersion to avoid needing SessionProvider
vi.mock("~/prompts/hooks/useLatestPromptVersion", () => ({
  useLatestPromptVersion: () => ({
    currentVersion: undefined,
    latestVersion: undefined,
    isOutdated: false,
    isLoading: false,
    nextVersion: undefined,
  }),
}));

// Mock name hooks to avoid tRPC queries. Wrapped in vi.fn() so individual
// tests (e.g. the same-name-variant scoreboard tests) can override the
// implementation for just their own targets. `useTargetNames` delegates to
// `useTargetName` so one override covers both the column title and the
// comparison scoreboard's batched lookup.
vi.mock("../../../hooks/useTargetName", () => {
  const useTargetName = vi.fn((target: { id: string }) => target.id);
  return {
    useTargetName,
    useTargetNames: (targets: ({ id: string } | undefined)[]) =>
      targets.map((target) => (target ? useTargetName(target) : "")),
  };
});
vi.mock("../../../hooks/useEvaluatorName", () => ({
  useEvaluatorName: () => "Exact Match",
  useEvaluatorNames: () => new Map(),
  useCodeEvaluatorIds: () => new Set(),
}));

const renderWithProviders = (ui: React.ReactElement) => {
  return render(<ChakraProvider value={defaultSystem}>{ui}</ChakraProvider>);
};

describe("TargetHeader", () => {
  const mockOnEdit = vi.fn();
  const mockOnDuplicate = vi.fn();
  const mockOnSwitch = vi.fn();
  const mockOnRemove = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  describe("Prompt target", () => {
    const promptTarget: TargetConfig = {
      id: "my-assistant",
      type: "prompt",
      promptId: "prompt-123",
      promptVersionId: "version-456",
      inputs: [],
      outputs: [],
      mappings: {},
    };

    it("renders prompt target with name and icon", () => {
      renderWithProviders(
        <TargetHeader
          target={promptTarget}
          onEdit={mockOnEdit}
          onRemove={mockOnRemove}
        />,
      );

      expect(screen.getByText("my-assistant")).toBeInTheDocument();
    });

    // Regression (bugbash 2026-07-14): duplicating a prompt gives two columns
    // that resolve to the same handle, and the header rendered both as a bare
    // "support-detailed" — indistinguishable on screen, even though the
    // comparison config's variant cards numbered them (1)/(2).
    describe("when another column resolves to the same name", () => {
      const duplicate = (id: string): TargetConfig => ({
        id,
        type: "prompt",
        promptId: "prompt-shared",
        inputs: [],
        outputs: [],
        mappings: {},
      });

      const seedSameNamedColumns = () => {
        vi.mocked(useTargetName).mockImplementation((t: { id: string }) =>
          t.id.startsWith("dup-") ? "support-detailed" : t.id,
        );
        const store = useEvaluationsV3Store.getState();
        store.reset();
        store.addTarget(duplicate("dup-1"));
        store.addTarget(duplicate("dup-2"));
      };

      it("numbers this column by its position among the columns", () => {
        seedSameNamedColumns();

        renderWithProviders(
          <TargetHeader
            target={duplicate("dup-1")}
            onEdit={mockOnEdit}
            onRemove={mockOnRemove}
          />,
        );

        expect(screen.getByText("support-detailed (1)")).toBeInTheDocument();
      });

      it("gives the second column the next ordinal", () => {
        seedSameNamedColumns();

        renderWithProviders(
          <TargetHeader
            target={duplicate("dup-2")}
            onEdit={mockOnEdit}
            onRemove={mockOnRemove}
          />,
        );

        expect(screen.getByText("support-detailed (2)")).toBeInTheDocument();
      });
    });

    // Regression (bugbash 2026-07-14): the header row is a flex row, and a flex
    // item's default min-width:auto meant the name and the "<winner> wins"
    // summary refused to shrink — the row grew past the column and the run
    // button slid under the next column. The button must be the one thing that
    // never shrinks; everything else absorbs the squeeze.
    it("keeps the play button from being squeezed out of its column", () => {
      renderWithProviders(
        <TargetHeader
          target={promptTarget}
          onEdit={mockOnEdit}
          onRemove={mockOnRemove}
        />,
      );

      expect(screen.getByTestId("target-play-button")).toHaveStyle({
        flexShrink: "0",
      });
    });

    it("lets the name shrink so it truncates instead of pushing siblings out", () => {
      renderWithProviders(
        <TargetHeader
          target={promptTarget}
          onEdit={mockOnEdit}
          onRemove={mockOnRemove}
        />,
      );

      expect(screen.getByTestId("target-header-button")).toHaveStyle({
        minWidth: "0",
      });
    });

    it("shows play button on the far right", () => {
      renderWithProviders(
        <TargetHeader
          target={promptTarget}
          onEdit={mockOnEdit}
          onRemove={mockOnRemove}
        />,
      );

      expect(screen.getByTestId("target-play-button")).toBeInTheDocument();
    });

    it("opens menu when clicking on the header", async () => {
      const user = userEvent.setup();
      renderWithProviders(
        <TargetHeader
          target={promptTarget}
          onEdit={mockOnEdit}
          onDuplicate={mockOnDuplicate}
          onRemove={mockOnRemove}
        />,
      );

      await user.click(screen.getByTestId("target-header-button"));

      await waitFor(() => {
        expect(screen.getByText("Edit Prompt")).toBeInTheDocument();
        expect(screen.getByText("Duplicate")).toBeInTheDocument();
        expect(screen.getByText("Remove from Workbench")).toBeInTheDocument();
      });
    });

    it("calls onEdit when clicking Edit Prompt", async () => {
      const user = userEvent.setup();
      renderWithProviders(
        <TargetHeader
          target={promptTarget}
          onEdit={mockOnEdit}
          onDuplicate={mockOnDuplicate}
          onRemove={mockOnRemove}
        />,
      );

      await user.click(screen.getByTestId("target-header-button"));
      await waitFor(() => {
        expect(screen.getByText("Edit Prompt")).toBeInTheDocument();
      });
      await user.click(screen.getByText("Edit Prompt"));

      expect(mockOnEdit).toHaveBeenCalledWith(promptTarget);
    });

    it("calls onDuplicate when clicking Duplicate", async () => {
      const user = userEvent.setup();
      renderWithProviders(
        <TargetHeader
          target={promptTarget}
          onEdit={mockOnEdit}
          onDuplicate={mockOnDuplicate}
          onRemove={mockOnRemove}
        />,
      );

      await user.click(screen.getByTestId("target-header-button"));
      await waitFor(() => {
        expect(screen.getByText("Duplicate")).toBeInTheDocument();
      });
      await user.click(screen.getByText("Duplicate"));

      expect(mockOnDuplicate).toHaveBeenCalledWith(promptTarget);
    });

    it("calls onRemove when clicking Remove from Workbench", async () => {
      const user = userEvent.setup();
      renderWithProviders(
        <TargetHeader
          target={promptTarget}
          onEdit={mockOnEdit}
          onDuplicate={mockOnDuplicate}
          onRemove={mockOnRemove}
        />,
      );

      await user.click(screen.getByTestId("target-header-button"));
      await waitFor(() => {
        expect(screen.getByText("Remove from Workbench")).toBeInTheDocument();
      });
      await user.click(screen.getByText("Remove from Workbench"));

      expect(mockOnRemove).toHaveBeenCalledWith(promptTarget.id);
    });

    it("shows Switch Prompt option in menu", async () => {
      const user = userEvent.setup();
      renderWithProviders(
        <TargetHeader
          target={promptTarget}
          onEdit={mockOnEdit}
          onDuplicate={mockOnDuplicate}
          onSwitch={mockOnSwitch}
          onRemove={mockOnRemove}
        />,
      );

      await user.click(screen.getByTestId("target-header-button"));

      await waitFor(() => {
        expect(screen.getByText("Switch Prompt")).toBeInTheDocument();
      });
    });

    it("calls onSwitch when clicking Switch Prompt", async () => {
      const user = userEvent.setup();
      renderWithProviders(
        <TargetHeader
          target={promptTarget}
          onEdit={mockOnEdit}
          onDuplicate={mockOnDuplicate}
          onSwitch={mockOnSwitch}
          onRemove={mockOnRemove}
        />,
      );

      await user.click(screen.getByTestId("target-header-button"));
      await waitFor(() => {
        expect(screen.getByText("Switch Prompt")).toBeInTheDocument();
      });
      await user.click(screen.getByText("Switch Prompt"));

      expect(mockOnSwitch).toHaveBeenCalledWith(promptTarget);
    });
  });

  describe("Unpublished modifications indicator", () => {
    const promptTargetWithLocalConfig: TargetConfig = {
      id: "modified-prompt",
      type: "prompt",
      promptId: "prompt-123",
      promptVersionId: "version-456",
      localPromptConfig: {
        llm: { model: "openai/gpt-4o", temperature: 0.7 },
        messages: [{ role: "system", content: "Modified content" }],
        inputs: [],
        outputs: [{ identifier: "output", type: "str" }],
      },
      inputs: [],
      outputs: [],
      mappings: {},
    };

    const promptTargetWithoutLocalConfig: TargetConfig = {
      id: "published-prompt",
      type: "prompt",
      promptId: "prompt-456",
      promptVersionId: "version-789",
      inputs: [],
      outputs: [],
      mappings: {},
    };

    it("does not show orange dot when no localPromptConfig", () => {
      renderWithProviders(
        <TargetHeader
          target={promptTargetWithoutLocalConfig}
          onEdit={mockOnEdit}
          onRemove={mockOnRemove}
        />,
      );

      expect(
        screen.queryByTestId("unpublished-indicator"),
      ).not.toBeInTheDocument();
    });

    it("shows orange dot when localPromptConfig exists", () => {
      renderWithProviders(
        <TargetHeader
          target={promptTargetWithLocalConfig}
          onEdit={mockOnEdit}
          onRemove={mockOnRemove}
        />,
      );

      expect(screen.getByTestId("unpublished-indicator")).toBeInTheDocument();
    });

    it("does not show orange dot for agent targets even with localPromptConfig", () => {
      const agentWithLocalConfig: TargetConfig = {
        id: "Agent",
        type: "agent",
        dbAgentId: "agent-123",
        // Even if this were somehow set, agents shouldn't show it
        inputs: [],
        outputs: [],
        mappings: {},
      };

      renderWithProviders(
        <TargetHeader
          target={agentWithLocalConfig}
          onEdit={mockOnEdit}
          onRemove={mockOnRemove}
        />,
      );

      expect(
        screen.queryByTestId("unpublished-indicator"),
      ).not.toBeInTheDocument();
    });
  });

  describe("Agent target", () => {
    const agentTarget: TargetConfig = {
      id: "Python Processor",
      type: "agent",
      dbAgentId: "agent-123",
      inputs: [],
      outputs: [],
      mappings: {},
    };

    it("renders agent target with name", () => {
      renderWithProviders(
        <TargetHeader
          target={agentTarget}
          onEdit={mockOnEdit}
          onRemove={mockOnRemove}
        />,
      );

      expect(screen.getByText("Python Processor")).toBeInTheDocument();
    });

    it("shows Edit Agent option for agents", async () => {
      const user = userEvent.setup();
      renderWithProviders(
        <TargetHeader
          target={agentTarget}
          onEdit={mockOnEdit}
          onRemove={mockOnRemove}
        />,
      );

      await user.click(screen.getByTestId("target-header-button"));

      await waitFor(() => {
        expect(screen.getByText("Edit Agent")).toBeInTheDocument();
        expect(screen.getByText("Remove from Workbench")).toBeInTheDocument();
      });
    });

    it("calls onEdit when clicking Edit Agent", async () => {
      const user = userEvent.setup();
      renderWithProviders(
        <TargetHeader
          target={agentTarget}
          onEdit={mockOnEdit}
          onRemove={mockOnRemove}
        />,
      );

      await user.click(screen.getByTestId("target-header-button"));
      await waitFor(() => {
        expect(screen.getByText("Edit Agent")).toBeInTheDocument();
      });
      await user.click(screen.getByText("Edit Agent"));

      expect(mockOnEdit).toHaveBeenCalledWith(agentTarget);
    });

    it("shows Switch Agent option in menu", async () => {
      const user = userEvent.setup();
      renderWithProviders(
        <TargetHeader
          target={agentTarget}
          onEdit={mockOnEdit}
          onSwitch={mockOnSwitch}
          onRemove={mockOnRemove}
        />,
      );

      await user.click(screen.getByTestId("target-header-button"));

      await waitFor(() => {
        expect(screen.getByText("Switch Agent")).toBeInTheDocument();
      });
    });

    it("calls onSwitch when clicking Switch Agent", async () => {
      const user = userEvent.setup();
      renderWithProviders(
        <TargetHeader
          target={agentTarget}
          onEdit={mockOnEdit}
          onSwitch={mockOnSwitch}
          onRemove={mockOnRemove}
        />,
      );

      await user.click(screen.getByTestId("target-header-button"));
      await waitFor(() => {
        expect(screen.getByText("Switch Agent")).toBeInTheDocument();
      });
      await user.click(screen.getByText("Switch Agent"));

      expect(mockOnSwitch).toHaveBeenCalledWith(agentTarget);
    });
  });

  describe("Evaluator target", () => {
    const evaluatorTarget: TargetConfig = {
      id: "Quality Checker",
      type: "evaluator",
      targetEvaluatorId: "evaluator-123",
      inputs: [],
      outputs: [],
      mappings: {},
    };

    it("renders evaluator target with name", () => {
      renderWithProviders(
        <TargetHeader
          target={evaluatorTarget}
          onEdit={mockOnEdit}
          onRemove={mockOnRemove}
        />,
      );

      expect(screen.getByText("Quality Checker")).toBeInTheDocument();
    });

    it("shows Edit Evaluator option for evaluators", async () => {
      const user = userEvent.setup();
      renderWithProviders(
        <TargetHeader
          target={evaluatorTarget}
          onEdit={mockOnEdit}
          onRemove={mockOnRemove}
        />,
      );

      await user.click(screen.getByTestId("target-header-button"));

      await waitFor(() => {
        expect(screen.getByText("Edit Evaluator")).toBeInTheDocument();
      });
    });

    it("shows Switch Evaluator option in menu", async () => {
      const user = userEvent.setup();
      renderWithProviders(
        <TargetHeader
          target={evaluatorTarget}
          onEdit={mockOnEdit}
          onSwitch={mockOnSwitch}
          onRemove={mockOnRemove}
        />,
      );

      await user.click(screen.getByTestId("target-header-button"));

      await waitFor(() => {
        expect(screen.getByText("Switch Evaluator")).toBeInTheDocument();
      });
    });

    it("calls onSwitch when clicking Switch Evaluator", async () => {
      const user = userEvent.setup();
      renderWithProviders(
        <TargetHeader
          target={evaluatorTarget}
          onEdit={mockOnEdit}
          onSwitch={mockOnSwitch}
          onRemove={mockOnRemove}
        />,
      );

      await user.click(screen.getByTestId("target-header-button"));
      await waitFor(() => {
        expect(screen.getByText("Switch Evaluator")).toBeInTheDocument();
      });
      await user.click(screen.getByText("Switch Evaluator"));

      expect(mockOnSwitch).toHaveBeenCalledWith(evaluatorTarget);
    });
  });

  describe("Target Summary with saved datasets (page refresh scenario)", () => {
    const targetWithResults: TargetConfig = {
      id: "test-prompt",
      type: "prompt",
      promptId: "prompt-123",
      promptVersionId: "version-456",
      inputs: [],
      outputs: [],
      mappings: {},
    };

    beforeEach(() => {
      // Reset the store before each test
      useEvaluationsV3Store.setState({
        name: "Test Evaluation",
        datasets: [],
        activeDatasetId: "saved-dataset-1",
        evaluators: [
          {
            id: "evaluator-1",
            dbEvaluatorId: "db-evaluator-1",
            evaluatorType: "langevals/llm_score",
            inputs: [],
            mappings: {},
          },
        ],
        targets: [targetWithResults],
        results: createInitialResults(),
        pendingSavedChanges: {},
        ui: createInitialUIState(),
      });
    });

    afterEach(() => {
      // Reset store after test
      useEvaluationsV3Store.getState().reset?.();
    });

    it("shows TargetSummary when results exist but savedRecords not yet loaded", () => {
      // Simulate page refresh: results are persisted but savedRecords are not yet loaded
      // This happens because savedRecords are loaded asynchronously from DB
      useEvaluationsV3Store.setState({
        datasets: [
          {
            id: "saved-dataset-1",
            name: "Saved Dataset",
            type: "saved",
            datasetId: "db-dataset-1",
            columns: [
              { id: "input", name: "input", type: "string" },
              { id: "expected", name: "expected", type: "string" },
            ],
            // savedRecords is undefined - not loaded yet!
          },
        ],
        results: {
          status: "idle",
          targetOutputs: {
            // Results ARE persisted from previous execution
            "test-prompt": ["Output 1", "Output 2", "Output 3"],
          },
          targetMetadata: {
            "test-prompt": [
              { duration: 1000, cost: 0.001 },
              { duration: 1200, cost: 0.002 },
              { duration: 800, cost: 0.001 },
            ],
          },
          evaluatorResults: {
            "test-prompt": {
              "evaluator-1": [
                { status: "passed", passed: true },
                { status: "passed", passed: true },
                { status: "failed", passed: false },
              ],
            },
          },
          errors: {},
        },
      });

      renderWithProviders(
        <TargetHeader
          target={targetWithResults}
          onEdit={mockOnEdit}
          onRemove={mockOnRemove}
        />,
      );

      // The summary should still be visible, showing latency, pass rate, etc.
      // Even though savedRecords hasn't loaded yet, we have results so we know the row count
      expect(screen.getByTestId("target-summary")).toBeInTheDocument();
    });
  });

  describe("given variant A and variant B share the same display name", () => {
    const variantATarget: TargetConfig = {
      id: "variant-a-target",
      type: "prompt",
      promptId: "prompt-a",
      inputs: [],
      outputs: [],
      mappings: {},
    };
    const variantBTarget: TargetConfig = {
      id: "variant-b-target",
      type: "prompt",
      promptId: "prompt-b",
      inputs: [],
      outputs: [],
      mappings: {},
    };
    const pairwiseColumnTarget: TargetConfig = {
      id: "pairwise-col",
      type: "evaluator",
      pairwise: {
        variantA: "variant-a-target",
        variantB: "variant-b-target",
        hasGoldenAnswer: true,
        goldenField: "expected",
        includeMetrics: [],
      },
      inputs: [],
      outputs: [],
      mappings: {},
    };

    beforeEach(() => {
      // Both variants resolve to the same name ("Bot") — only the mocked
      // model differs between them.
      vi.mocked(useTargetName).mockImplementation((target: { id: string }) =>
        target.id === "variant-a-target" || target.id === "variant-b-target"
          ? "Bot"
          : target.id,
      );

      useEvaluationsV3Store.setState({
        name: "Test Evaluation",
        datasets: [],
        activeDatasetId: undefined,
        evaluators: [],
        targets: [variantATarget, variantBTarget, pairwiseColumnTarget],
        results: {
          ...createInitialResults(),
          // Fallback row-count path: one persisted output row for the
          // pairwise column target.
          targetOutputs: { "pairwise-col": ["n/a"] },
          evaluatorResults: {
            "pairwise-col": {
              // Variant A wins the only row.
              "pairwise-col": [{ label: "variant-a-target" }],
            },
          },
        },
        pendingSavedChanges: {},
        ui: createInitialUIState(),
      });
    });

    afterEach(() => {
      vi.mocked(useTargetName).mockImplementation(
        (target: { id: string }) => target.id,
      );
      useEvaluationsV3Store.getState().reset?.();
    });

    /** @scenario Same-name variants fall back to numbering */
    it("shows numbered names instead of two identical labels", () => {
      renderWithProviders(
        <TargetHeader
          target={pairwiseColumnTarget}
          onEdit={mockOnEdit}
          onRemove={mockOnRemove}
        />,
      );

      expect(screen.getByText("Bot (1) wins")).toBeInTheDocument();
    });
  });

  describe("given a variant target is highlighted via a pairwise verdict click", () => {
    const promptTarget: TargetConfig = {
      id: "highlighted-target",
      type: "prompt",
      promptId: "prompt-123",
      inputs: [],
      outputs: [],
      mappings: {},
    };

    afterEach(() => {
      useEvaluationsV3Store.getState().reset?.();
    });

    /** @scenario Clicking the winner highlights its source column */
    it("glows the header when this target is the highlighted variant", () => {
      useEvaluationsV3Store.setState({
        ui: {
          ...createInitialUIState(),
          highlightedVariantTargetId: "highlighted-target",
        },
      });

      renderWithProviders(
        <TargetHeader
          target={promptTarget}
          onEdit={mockOnEdit}
          onRemove={mockOnRemove}
        />,
      );

      expect(
        screen.getByTestId("target-header-highlighted"),
      ).toBeInTheDocument();
    });

    it("does not glow the header when a different target is highlighted", () => {
      useEvaluationsV3Store.setState({
        ui: {
          ...createInitialUIState(),
          highlightedVariantTargetId: "some-other-target",
        },
      });

      renderWithProviders(
        <TargetHeader
          target={promptTarget}
          onEdit={mockOnEdit}
          onRemove={mockOnRemove}
        />,
      );

      expect(
        screen.queryByTestId("target-header-highlighted"),
      ).not.toBeInTheDocument();
    });
  });
});
