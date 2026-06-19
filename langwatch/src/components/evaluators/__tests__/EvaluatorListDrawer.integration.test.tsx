/**
 * @vitest-environment jsdom
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { EvaluatorWithFields } from "~/server/evaluators/evaluator.service";
import { EvaluatorListDrawer } from "../EvaluatorListDrawer";

const { mockEvaluator } = vi.hoisted(() => ({
  mockEvaluator: {
    id: "evaluator_1",
    name: "Exactness",
    type: "code",
    config: {},
    updatedAt: "2026-01-01T00:00:00.000Z",
  },
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
        useMutation: () => ({ mutate: vi.fn() }),
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
});
