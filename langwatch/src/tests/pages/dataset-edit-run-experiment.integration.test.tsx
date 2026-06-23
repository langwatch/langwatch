/**
 * @vitest-environment jsdom
 *
 * Integration test for the dataset editor's Run experiment action, which
 * seeds the evaluations workbench with the saved dataset.
 * See specs/datasets/dataset-editor.feature.
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockPush } = vi.hoisted(() => ({ mockPush: vi.fn() }));

vi.mock("~/utils/compat/next-router", () => ({
  useRouter: () => ({
    query: { id: "ds-1" },
    push: mockPush,
    back: vi.fn(),
  }),
}));

vi.mock("~/hooks/useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: () => ({
    project: { id: "proj-1", slug: "test-project" },
    hasPermission: () => true,
  }),
}));

// The page lifted the dataset read to decide the I-READY gate (ADR-032), so it
// now calls tRPC directly — stub it as a settled, ready dataset so the editor
// chrome renders. The gate is `isSuccess && status === "ready"`, so the mock
// must report `isSuccess: true` (a `status: "ready"` payload alone is gated out
// until the query resolves).
vi.mock("~/utils/api", () => ({
  api: {
    dataset: {
      getById: {
        useQuery: () => ({
          data: { status: "ready" },
          isLoading: false,
          isSuccess: true,
          refetch: vi.fn(),
        }),
      },
    },
  },
}));

vi.mock("~/components/DashboardLayout", () => ({
  DashboardLayout: ({ children }: { children?: ReactNode }) => (
    <div>{children}</div>
  ),
}));

// Render only the chrome (headerActions) so the page's Run experiment button shows
vi.mock("~/components/datasets/editor/DatasetEditorTable", () => ({
  DatasetEditorTable: ({ headerActions }: { headerActions?: ReactNode }) => (
    <div data-testid="dataset-editor-table">{headerActions}</div>
  ),
}));

const { default: DatasetEditPage } = await import(
  "~/pages/[project]/datasets/[id]"
);

describe("Dataset editor Run experiment", () => {
  afterEach(() => cleanup());
  beforeEach(() => vi.clearAllMocks());

  describe("when editing a saved dataset", () => {
    /** @scenario Run an experiment from a dataset */
    it("navigates to a new experiment workbench seeded with the dataset", async () => {
      const user = userEvent.setup();
      render(
        <ChakraProvider value={defaultSystem}>
          <DatasetEditPage />
        </ChakraProvider>,
      );

      await user.click(screen.getByTestId("run-experiment-from-dataset"));

      expect(mockPush).toHaveBeenCalledWith({
        pathname: "/test-project/experiments/workbench",
        query: { datasetId: "ds-1" },
      });
    });
  });
});
