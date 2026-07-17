/**
 * @vitest-environment jsdom
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { EvaluatorWithFields } from "~/server/evaluators/evaluator.service";
import { EvaluatorListDrawer } from "../EvaluatorListDrawer";

const {
  mockEvaluator,
  mockComparisonEvaluator,
  mockLegacyPairwiseEvaluator,
  deleteMutate,
} = vi.hoisted(() => ({
  mockEvaluator: {
    id: "evaluator_1",
    name: "Exactness",
    type: "code",
    config: {},
    updatedAt: "2026-01-01T00:00:00.000Z",
  },
  mockComparisonEvaluator: {
    id: "evaluator_comparison",
    name: "Comparison",
    type: "llm",
    config: { evaluatorType: "langevals/select_best_compare" },
    updatedAt: "2026-01-01T00:00:00.000Z",
  },
  mockLegacyPairwiseEvaluator: {
    id: "evaluator_pairwise",
    name: "Pairwise Compare",
    type: "llm",
    config: { evaluatorType: "langevals/pairwise_compare" },
    updatedAt: "2026-01-01T00:00:00.000Z",
  },
  deleteMutate: vi.fn(),
}));

let evaluatorsData: unknown[] = [mockEvaluator];

vi.mock("~/utils/api", () => ({
  api: {
    useContext: () => ({
      evaluators: { getAll: { invalidate: vi.fn() } },
    }),
    evaluators: {
      getAll: {
        useQuery: () => ({ isLoading: false, data: evaluatorsData }),
      },
      delete: {
        useMutation: () => ({ mutate: deleteMutate, isLoading: false }),
      },
    },
  },
}));

vi.mock("~/hooks/useDrawer", () => ({
  useDrawer: () => ({
    closeDrawer: vi.fn(),
    openDrawer: vi.fn(),
    canGoBack: false,
    goBack: vi.fn(),
  }),
  getComplexProps: () => ({}),
  getFlowCallbacks: () => undefined,
}));

vi.mock("~/hooks/useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: () => ({ project: { id: "project-1" } }),
}));

vi.mock("../EvaluatorApiUsageDialog", () => ({
  EvaluatorApiUsageDialog: () => null,
}));

vi.mock("../../checks/EvaluatorSelection", () => ({
  evaluatorTempNameMap: {},
}));

const Wrapper = ({ children }: { children: React.ReactNode }) => (
  <ChakraProvider value={defaultSystem}>{children}</ChakraProvider>
);

describe("EvaluatorListDrawer", () => {
  const onSelect = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    evaluatorsData = [mockEvaluator];
  });

  afterEach(() => {
    cleanup();
  });

  const renderDrawer = (
    props: Partial<{
      filterEvaluatorType: string;
      title: string;
      createLabel: string;
      itemLabel: string;
    }> = {},
  ) =>
    render(<EvaluatorListDrawer open={true} onSelect={onSelect} {...props} />, {
      wrapper: Wrapper,
    });

  describe("when keyboard keys come from the nested actions menu", () => {
    it("does not select the card on Enter from the menu trigger", async () => {
      renderDrawer();

      const menuTrigger = await screen.findByTestId(
        `evaluator-menu-${mockEvaluator.id}`,
      );
      fireEvent.keyDown(menuTrigger, { key: "Enter" });
      fireEvent.keyDown(menuTrigger, { key: " " });

      expect(onSelect).not.toHaveBeenCalled();
    });
  });

  describe("when the card itself has focus", () => {
    it("selects the evaluator on Enter", async () => {
      renderDrawer();

      const card = await screen.findByTestId(
        `evaluator-card-${mockEvaluator.id}`,
      );
      fireEvent.keyDown(card, { key: "Enter" });

      expect(onSelect).toHaveBeenCalledWith(
        mockEvaluator as unknown as EvaluatorWithFields,
      );
    });
  });

  describe("when deleting an evaluator", () => {
    it("confirms via the modal dialog instead of window.confirm and deletes on confirm", async () => {
      const user = userEvent.setup();
      const confirmSpy = vi.spyOn(window, "confirm");
      // The component closes the dialog when the mutation settles.
      deleteMutate.mockImplementation(
        (_vars: unknown, opts?: { onSettled?: () => void }) =>
          opts?.onSettled?.(),
      );
      renderDrawer();

      await user.click(
        await screen.findByTestId(`evaluator-menu-${mockEvaluator.id}`),
      );
      await user.click(
        await screen.findByTestId(`evaluator-delete-${mockEvaluator.id}`),
      );

      // The reusable modal is shown, not the native confirm dialog.
      await waitFor(() => {
        expect(screen.getByText("Delete evaluator")).toBeInTheDocument();
        expect(
          screen.getByText(`Are you sure you want to delete "Exactness"?`),
        ).toBeInTheDocument();
      });
      expect(confirmSpy).not.toHaveBeenCalled();
      expect(deleteMutate).not.toHaveBeenCalled();

      await user.click(screen.getByRole("button", { name: "Delete" }));

      expect(deleteMutate).toHaveBeenCalledWith(
        { id: mockEvaluator.id, projectId: "project-1" },
        expect.objectContaining({ onSettled: expect.any(Function) }),
      );
      // Once the mutation settles the confirmation modal is dismissed.
      await waitFor(() => {
        expect(screen.queryByText("Delete evaluator")).not.toBeInTheDocument();
      });

      confirmSpy.mockRestore();
    });

    it("does not delete when the modal is cancelled", async () => {
      const user = userEvent.setup();
      renderDrawer();

      await user.click(
        await screen.findByTestId(`evaluator-menu-${mockEvaluator.id}`),
      );
      await user.click(
        await screen.findByTestId(`evaluator-delete-${mockEvaluator.id}`),
      );

      await user.click(await screen.findByRole("button", { name: "Cancel" }));

      expect(deleteMutate).not.toHaveBeenCalled();
    });
  });

  describe("when no filterEvaluatorType is given (generic per-target Add Evaluator)", () => {
    it("excludes Comparison and legacy Pairwise evaluators from the list", async () => {
      evaluatorsData = [
        mockEvaluator,
        mockComparisonEvaluator,
        mockLegacyPairwiseEvaluator,
      ];
      renderDrawer();

      await screen.findByTestId(`evaluator-card-${mockEvaluator.id}`);

      expect(
        screen.queryByTestId(`evaluator-card-${mockComparisonEvaluator.id}`),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByTestId(
          `evaluator-card-${mockLegacyPairwiseEvaluator.id}`,
        ),
      ).not.toBeInTheDocument();
    });
  });

  describe("when filterEvaluatorType narrows to Comparison", () => {
    it("shows only Comparison evaluators", async () => {
      evaluatorsData = [
        mockEvaluator,
        mockComparisonEvaluator,
        mockLegacyPairwiseEvaluator,
      ];
      renderDrawer({ filterEvaluatorType: "langevals/select_best_compare" });

      await screen.findByTestId(`evaluator-card-${mockComparisonEvaluator.id}`);

      expect(
        screen.queryByTestId(`evaluator-card-${mockEvaluator.id}`),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByTestId(
          `evaluator-card-${mockLegacyPairwiseEvaluator.id}`,
        ),
      ).not.toBeInTheDocument();
    });

    it("uses comparison language in the empty state", async () => {
      evaluatorsData = [];
      renderDrawer({
        filterEvaluatorType: "langevals/select_best_compare",
        title: "Choose Comparison",
        createLabel: "New Comparison",
        itemLabel: "comparison",
      });

      expect(await screen.findByText("No comparisons yet")).toBeInTheDocument();
      expect(
        screen.getByText("Create your first comparison to get started"),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: /create your first comparison/i }),
      ).toBeInTheDocument();
    });
  });

  // The empty state's heading is fixed ("Create your first X to get started"),
  // so its button must agree with it no matter how the caller worded the header
  // button — otherwise a createLabel like "Add comparison" renders verbatim on a
  // button sitting directly under a heading that says something else.
  describe("when the create label does not follow the default New <Item> shape", () => {
    it("keeps the empty-state button wording aligned with the empty-state heading", async () => {
      evaluatorsData = [];
      renderDrawer({ createLabel: "Add comparison", itemLabel: "comparison" });

      expect(
        await screen.findByText("Create your first comparison to get started"),
      ).toBeInTheDocument();
      expect(
        screen.getByTestId("create-first-evaluator-button"),
      ).toHaveTextContent("Create your first comparison");
    });

    it("leaves the header create button on the caller's wording", async () => {
      evaluatorsData = [];
      renderDrawer({ createLabel: "Add comparison", itemLabel: "comparison" });

      expect(await screen.findByTestId("new-evaluator-button")).toHaveTextContent(
        "Add comparison",
      );
    });
  });
});
