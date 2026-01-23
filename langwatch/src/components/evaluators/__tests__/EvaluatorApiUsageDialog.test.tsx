/**
 * @vitest-environment jsdom
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EvaluatorApiUsageDialog } from "../EvaluatorApiUsageDialog";

// Mock dependencies
vi.mock("next/router", () => ({
  useRouter: () => ({
    push: vi.fn(),
    query: {},
    asPath: "/test",
  }),
}));

vi.mock("~/hooks/useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: () => ({
    project: { id: "test-project-id", slug: "test-project" },
    organization: { id: "test-org-id" },
    team: { id: "test-team-id" },
  }),
}));

// Mock evaluator with built-in type
const mockEvaluatorWithType = {
  id: "evaluator-1",
  name: "PII Detection",
  slug: "pii-detection",
  type: "evaluator" as const,
  config: { evaluatorType: "presidio/pii_detection", settings: {} },
  workflowId: null,
  projectId: "test-project-id",
  archivedAt: null,
  createdAt: new Date("2025-01-10T10:00:00Z"),
  updatedAt: new Date("2025-01-15T10:00:00Z"),
};

// Mock evaluator without type (workflow)
const mockWorkflowEvaluator = {
  id: "evaluator-2",
  name: "Custom Scorer",
  slug: "custom-scorer",
  type: "workflow" as const,
  config: {},
  workflowId: "workflow-123",
  projectId: "test-project-id",
  archivedAt: null,
  createdAt: new Date("2025-01-05T10:00:00Z"),
  updatedAt: new Date("2025-01-12T10:00:00Z"),
};

const renderDialog = (
  evaluator: typeof mockEvaluatorWithType | typeof mockWorkflowEvaluator | null,
  open = true,
  onClose = vi.fn(),
) => {
  return render(
    <ChakraProvider value={defaultSystem}>
      <EvaluatorApiUsageDialog
        evaluator={evaluator}
        open={open}
        onClose={onClose}
      />
    </ChakraProvider>,
  );
};

describe("EvaluatorApiUsageDialog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  describe("rendering", () => {
    it("does not render when evaluator is null", () => {
      renderDialog(null);
      expect(screen.queryByText("Use from API")).not.toBeInTheDocument();
    });

    it("does not render when open is false", () => {
      renderDialog(mockEvaluatorWithType, false);
      expect(screen.queryByText("Use from API")).not.toBeInTheDocument();
    });

    it("renders dialog with evaluator info when open", () => {
      renderDialog(mockEvaluatorWithType);
      expect(screen.getByText("Use via API")).toBeInTheDocument();
      expect(screen.getByText("PII Detection")).toBeInTheDocument();
      expect(screen.getByText("(pii-detection)")).toBeInTheDocument();
    });

    it("renders mode and language selectors", () => {
      renderDialog(mockEvaluatorWithType);
      expect(screen.getByTestId("usage-mode-select")).toBeInTheDocument();
      expect(screen.getByTestId("language-select")).toBeInTheDocument();
    });

    it("shows API key link", () => {
      renderDialog(mockEvaluatorWithType);
      expect(screen.getByText("Find your API key")).toBeInTheDocument();
    });

    it("shows documentation link", () => {
      renderDialog(mockEvaluatorWithType);
      expect(screen.getByText("documentation")).toBeInTheDocument();
    });
  });

  describe("mode switching", () => {
    it("defaults to Online Evaluation mode", () => {
      renderDialog(mockEvaluatorWithType);
      const modeSelect = screen.getByTestId(
        "usage-mode-select",
      ) as HTMLSelectElement;
      expect(modeSelect.value).toBe("online");
    });

    it("switches to Experiment mode when selected", async () => {
      const user = userEvent.setup();
      renderDialog(mockEvaluatorWithType);

      const modeSelect = screen.getByTestId("usage-mode-select");
      await user.selectOptions(modeSelect, "experiment");

      await waitFor(() => {
        expect(
          (screen.getByTestId("usage-mode-select") as HTMLSelectElement).value,
        ).toBe("experiment");
      });
    });

    it("shows experiment-specific code when in Experiment mode", async () => {
      const user = userEvent.setup();
      renderDialog(mockEvaluatorWithType);

      const modeSelect = screen.getByTestId("usage-mode-select");
      await user.selectOptions(modeSelect, "experiment");

      await waitFor(() => {
        // Code is in a pre/code block, check text content
        const codeBlocks = document.querySelectorAll("pre");
        const hasExperimentCode = Array.from(codeBlocks).some((block) =>
          block.textContent?.includes("langwatch.experiment.init"),
        );
        expect(hasExperimentCode).toBe(true);
      });
    });

    it("shows online evaluation code when in Online mode", () => {
      renderDialog(mockEvaluatorWithType);
      // Code is in a pre/code block, check text content
      const codeBlocks = document.querySelectorAll("pre");
      const hasOnlineCode = Array.from(codeBlocks).some((block) =>
        block.textContent?.includes("langwatch.evaluation.evaluate"),
      );
      expect(hasOnlineCode).toBe(true);
    });
  });

  describe("language switching", () => {
    it("defaults to Python", () => {
      renderDialog(mockEvaluatorWithType);
      const langSelect = screen.getByTestId(
        "language-select",
      ) as HTMLSelectElement;
      expect(langSelect.value).toBe("python");
    });

    it("switches to TypeScript when selected", async () => {
      const user = userEvent.setup();
      renderDialog(mockEvaluatorWithType);

      const langSelect = screen.getByTestId("language-select");
      await user.selectOptions(langSelect, "typescript");

      await waitFor(() => {
        expect(
          (screen.getByTestId("language-select") as HTMLSelectElement).value,
        ).toBe("typescript");
      });
    });

    it("shows TypeScript code when TypeScript is selected", async () => {
      const user = userEvent.setup();
      renderDialog(mockEvaluatorWithType);

      const langSelect = screen.getByTestId("language-select");
      await user.selectOptions(langSelect, "typescript");

      await waitFor(() => {
        const codeBlocks = document.querySelectorAll("pre");
        const hasTypeScriptCode = Array.from(codeBlocks).some((block) =>
          block.textContent?.includes('import { LangWatch } from "langwatch"'),
        );
        expect(hasTypeScriptCode).toBe(true);
      });
    });

    it("shows Python code with @langwatch.span decorator", () => {
      renderDialog(mockEvaluatorWithType);
      const codeBlocks = document.querySelectorAll("pre");
      const hasPythonCode = Array.from(codeBlocks).some((block) =>
        block.textContent?.includes("@langwatch.span()"),
      );
      expect(hasPythonCode).toBe(true);
    });

    it("shows cURL code when cURL is selected", async () => {
      const user = userEvent.setup();
      renderDialog(mockEvaluatorWithType);

      const langSelect = screen.getByTestId("language-select");
      await user.selectOptions(langSelect, "bash");

      await waitFor(() => {
        const codeBlocks = document.querySelectorAll("pre");
        const hasCurlCode = Array.from(codeBlocks).some((block) =>
          block.textContent?.includes("curl -X POST"),
        );
        expect(hasCurlCode).toBe(true);
      });
    });
  });

  describe("evaluator slug in code", () => {
    it("includes evaluator slug in code", () => {
      renderDialog(mockEvaluatorWithType);
      const codeBlocks = document.querySelectorAll("pre");
      const hasSlug = Array.from(codeBlocks).some((block) =>
        block.textContent?.includes("pii-detection"),
      );
      expect(hasSlug).toBe(true);
    });

    it("includes evaluator name in code", () => {
      renderDialog(mockEvaluatorWithType);
      const codeBlocks = document.querySelectorAll("pre");
      const hasName = Array.from(codeBlocks).some((block) =>
        block.textContent?.includes("PII Detection"),
      );
      expect(hasName).toBe(true);
    });
  });

  describe("close behavior", () => {
    it("calls onClose when dialog is closed", async () => {
      const onClose = vi.fn();
      const user = userEvent.setup();
      renderDialog(mockEvaluatorWithType, true, onClose);

      // Find and click close button
      const closeButton = screen.getByRole("button", { name: /close/i });
      await user.click(closeButton);

      await waitFor(() => {
        expect(onClose).toHaveBeenCalled();
      });
    });
  });

  describe("workflow evaluator", () => {
    it("renders for workflow evaluators", () => {
      renderDialog(mockWorkflowEvaluator);
      expect(screen.getByText("Use via API")).toBeInTheDocument();
      expect(screen.getByText("Custom Scorer")).toBeInTheDocument();
    });

    it("uses default data fields for workflow evaluators", () => {
      renderDialog(mockWorkflowEvaluator);
      // Should use default fields since workflow has no requiredFields
      const codeBlocks = document.querySelectorAll("pre");
      // Default fields are "input" and "output"
      const hasDefaultFields = Array.from(codeBlocks).some(
        (block) =>
          block.textContent?.includes('"input"') &&
          block.textContent?.includes('"output"'),
      );
      expect(hasDefaultFields).toBe(true);
    });
  });
});
