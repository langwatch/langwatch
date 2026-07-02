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

const { mockEvaluator, deleteMutate } = vi.hoisted(() => ({
  mockEvaluator: {
    id: "evaluator_1",
    name: "Exactness",
    type: "code",
    config: {},
    updatedAt: "2026-01-01T00:00:00.000Z",
  },
  deleteMutate: vi.fn(),
}));

vi.mock("~/utils/api", () => ({
  api: {
    useContext: () => ({
      evaluators: { getAll: { invalidate: vi.fn() } },
    }),
    evaluators: {
      getAll: {
        useQuery: () => ({ isLoading: false, data: [mockEvaluator] }),
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
  });

  afterEach(() => {
    cleanup();
  });

  const renderDrawer = () =>
    render(<EvaluatorListDrawer open={true} onSelect={onSelect} />, {
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
});
