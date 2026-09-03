// @vitest-environment jsdom
/**
 * A workflow agent runs a whole Studio workflow, not a single code node. The
 * target column has to say so: reading the code icon there is what tells an
 * author their target is broken when it is only mislabelled.
 *
 * @see specs/agents/workflow-agent-as-target.feature
 */
import "@testing-library/jest-dom/vitest";

import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../../../behavior/experiments-v3/use-evaluations-v3-store", () => ({
  useEvaluationsV3Store: (selector?: (state: unknown) => unknown) =>
    selector
      ? selector({
          targets: [],
          rows: [],
          cells: {},
          evaluators: [],
          datasets: [{ id: "dataset_1", type: "inline", inline: { records: {} } }],
          results: {
            targetOutputs: {},
            targetMetadata: {},
            errors: {},
            evaluatorResults: {},
            executingCells: {},
          },
          activeDatasetId: "dataset_1",
          ui: { highlightedVariantTargetId: null, highlightedVariantOutcome: null },
        })
      : undefined,
}));

vi.mock("@langwatch/prompt-web/prompts/hooks/useLatestPromptVersion", () => ({
  useLatestPromptVersion: () => ({ data: undefined, isLoading: false }),
}));

vi.mock("../../../../../behavior/experiments-v3/use-target-name", () => ({
  useTargetName: () => "Support agent",
  useTargetNames: () => [],
}));

vi.mock("../../../../../behavior/experiments-v3/use-prompt-template-fields", () => ({
  usePromptTemplateFields: () => ({ fields: [], isLoading: false }),
}));

import type { TargetConfig } from "../../../../../model/experiments-v3/types";
import { TargetHeader } from "../target-header";

const Wrapper = ({ children }: { children: React.ReactNode }) => (
  <ChakraProvider value={defaultSystem}>{children}</ChakraProvider>
);

function renderHeader(target: TargetConfig) {
  return render(<TargetHeader target={target} />, { wrapper: Wrapper });
}

const WORKFLOW_AGENT = {
  id: "target_1",
  type: "agent",
  agentType: "workflow",
  agentId: "agent_1",
  mappings: { dataset_1: {} },
} as unknown as TargetConfig;

const CODE_AGENT = {
  id: "target_2",
  type: "agent",
  agentType: "code",
  agentId: "agent_2",
  mappings: { dataset_1: {} },
} as unknown as TargetConfig;

describe("given an experiment target that is a workflow agent", () => {
  afterEach(() => {
    cleanup();
  });

  describe("when the target column header renders", () => {
    /** @scenario "The target column shows a workflow icon" */
    it("shows the workflow icon and not the code icon", () => {
      renderHeader(WORKFLOW_AGENT);

      expect(screen.getByTestId("icon-workflow")).toBeInTheDocument();
      expect(screen.queryByTestId("icon-code")).not.toBeInTheDocument();
    });
  });
});

describe("given an experiment target that is a code agent", () => {
  afterEach(() => {
    cleanup();
  });

  describe("when the target column header renders", () => {
    /** @scenario "The target column shows a workflow icon" */
    it("still shows the code icon, so the workflow icon means something", () => {
      renderHeader(CODE_AGENT);

      expect(screen.getByTestId("icon-code")).toBeInTheDocument();
      expect(screen.queryByTestId("icon-workflow")).not.toBeInTheDocument();
    });
  });
});
