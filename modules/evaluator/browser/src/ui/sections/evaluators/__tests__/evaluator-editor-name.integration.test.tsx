/**
 * @vitest-environment jsdom
 * The Evaluator Name typed after the create form's reset is the name it is created under
 * (WEB-013). Vitest runs without the React Compiler, so this guards the wiring, not the memo.
 */
import { renderWithDesignSystem } from "@langwatch/design-system/testing";
import { cleanup, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

const { create } = vi.hoisted(() => ({ create: vi.fn() }));

vi.mock("@langwatch/browser-host/use-organization-team-project", () => ({
  useOrganizationTeamProject: () => ({ project: { id: "p1", slug: "p1" } }),
}));
vi.mock("@langwatch/browser-host/drawer", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getComplexProps: () => ({}),
  getDrawerStack: () => [],
  getFlowCallbacks: () => undefined,
  useDrawer: () => ({ closeDrawer: vi.fn(), canGoBack: false, goBack: vi.fn() }),
  useDrawerParams: () => ({}),
}));
vi.mock("../../../../behavior/evaluator-api.ts", () => ({
  evaluatorApi: {
    modelProvider: {
      getResolvedDefault: { useQuery: () => ({ data: null, isLoading: false }) },
    },
  },
}));
vi.mock("@langwatch/evaluator-client", () => ({
  evaluatorClient: {
    useUtils: () => ({
      evaluators: { getAll: { invalidate: vi.fn() }, getById: { invalidate: vi.fn() } },
    }),
    evaluators: {
      getById: { useQuery: () => ({ data: undefined, isLoading: false }) },
      create: { useMutation: () => ({ mutate: create, isPending: false }) },
      update: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
    },
  },
}));

import { EvaluatorEditorDrawer } from "../evaluator-editor-drawer.tsx";

describe("EvaluatorEditorDrawer", () => {
  afterEach(cleanup);

  describe("when the user renames a new built-in evaluator", () => {
    it("creates it under the typed name", async () => {
      const user = userEvent.setup();
      renderWithDesignSystem(<EvaluatorEditorDrawer open evaluatorType="langevals/exact_match" />);

      const input = await screen.findByTestId("evaluator-name-input");
      await waitFor(() => expect(input).toHaveValue("Exact Match Evaluator"));
      await user.clear(input);
      await user.type(input, "My check");
      await user.click(screen.getByTestId("save-evaluator-button"));

      expect(create).toHaveBeenCalledWith(expect.objectContaining({ name: "My check" }));
    });
  });
});
