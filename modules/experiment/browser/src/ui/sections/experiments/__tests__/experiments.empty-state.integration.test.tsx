/**
 * @vitest-environment jsdom
 * @see specs/skills/empty-state-skill-setup.feature
 */

import "@testing-library/jest-dom/vitest";
import { uiDeclarations, type UiDeclarations } from "@langwatch/browser-host/declarations";
import { renderWithDesignSystem } from "@langwatch/design-system/testing";
import { SetupWithAgentButtonToken } from "@langwatch/trace-client";
import { cleanup, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const declarations: { current: UiDeclarations | undefined } = vi.hoisted(() => ({
  current: undefined,
}));

vi.mock("@langwatch/browser-host/capabilities", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useUiDeclarations: () => declarations.current,
}));
vi.mock("@langwatch/browser-host/use-organization-team-project", () => ({
  useOrganizationTeamProject: () => ({ project: { id: "proj-1", slug: "web-app" } }),
}));
vi.mock("@langwatch/browser-host/use-router", () => ({
  useRouter: () => ({ isReady: true, push: vi.fn(), query: {} }),
}));
vi.mock("../../../../model/workflow/workflow-host.ts", () => ({
  useWorkflowHost: () => ({}),
}));
vi.mock("../../../../behavior/experiments/use-create-experiment.ts", () => ({
  useCreateExperiment: () => ({ createNewExperiment: vi.fn(), isCreating: false }),
}));
vi.mock("../../../../behavior/experiments/use-copy-experiment.ts", () => ({
  useCopyExperiment: () => ({ copyExperimentTo: vi.fn(), isCopying: false }),
}));
vi.mock("../../../../ui/elements/navigation-footer.tsx", () => ({
  PAGE_SIZE_OPTIONS: [25],
  useNavigationFooter: () => ({
    pageOffset: 0,
    pageSize: 25,
    useUpdateTotalHits: () => undefined,
  }),
}));
vi.mock("../../../../ui/elements/experiments/create-experiment-button.tsx", () => ({
  CreateExperimentButton: () => <button>Create experiment</button>,
}));
vi.mock("../../../../behavior/experiment-api.ts", () => ({
  experimentApi: {
    experiments: {
      getAllForEvaluationsList: {
        useQuery: () => ({
          data: { experiments: [], totalHits: 0 },
          isLoading: false,
          isError: false,
          isSuccess: true,
          refetch: vi.fn(),
        }),
      },
      deleteExperiment: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
    },
  },
}));

import { ExperimentsPage } from "../experiments.screen.tsx";

const traceLends = uiDeclarations([
  {
    name: "trace",
    installation: {
      capabilities: {},
      lends: [
        {
          token: SetupWithAgentButtonToken,
          load: async () => ({
            default: ({ surface }: { surface: string }) => (
              <button>Setup via Agent ({surface})</button>
            ),
          }),
        },
      ],
    },
  },
]);

afterEach(() => {
  cleanup();
  declarations.current = undefined;
});

describe("given a project with no experiments", () => {
  describe("when the page is opened", () => {
    /** @scenario Every empty surface offers its own skill */
    it("offers trace's set-up-with-AI control for experiments", async () => {
      declarations.current = traceLends;
      renderWithDesignSystem(<ExperimentsPage />);

      expect(screen.getByRole("heading", { name: "No experiments yet" })).toBeInTheDocument();
      expect(
        await screen.findByRole("button", { name: "Setup via Agent (experiments)" }),
      ).toBeInTheDocument();
    });
  });
});
