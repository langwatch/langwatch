/**
 * @vitest-environment jsdom
 *
 * Integration tests for commit-message autogen gating in the
 * save-version fields: with no Fast model resolved, generation never
 * auto-fires (no doomed request, no unprompted missing-model toast)
 * and the description field degrades to an explicit sparkles button.
 *
 * UX contract: specs/model-providers/missing-model-popup.feature.
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { FormProvider, useForm } from "react-hook-form";
import { afterEach, describe, expect, it, vi } from "vitest";

const { mockResolvedDefault, mockGenerateMutate } = vi.hoisted(() => ({
  mockResolvedDefault: {
    current: null as { model: string } | null,
  },
  mockGenerateMutate: vi.fn(),
}));

vi.mock("~/hooks/useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: () => ({
    project: { id: "proj-1", slug: "test-project" },
  }),
}));

vi.mock("~/utils/api", () => ({
  api: {
    modelProvider: {
      getResolvedDefault: {
        useQuery: () => ({
          data: mockResolvedDefault.current,
          isLoading: false,
          isFetched: true,
        }),
      },
    },
    workflow: {
      generateCommitMessage: {
        useMutation: () => ({
          mutate: mockGenerateMutate,
          isLoading: false,
        }),
      },
    },
  },
}));

vi.mock("../../hooks/useWorkflowStore", () => ({
  useWorkflowStore: (selector: (s: unknown) => unknown) =>
    selector({
      checkCanCommitNewVersion: () => true,
      getWorkflow: () => ({
        workflow_id: "wf-1",
        name: "Test Workflow",
        nodes: [],
        edges: [],
        state: {},
      }),
    }),
}));

vi.mock("../History", () => ({
  useVersionState: () => ({
    previousVersion: {
      id: "v-1",
      version: "1.0",
      dsl: { nodes: [], edges: [], name: "Prev", workflow_id: "wf-1" },
    },
    nextVersion: "1.1",
  }),
}));

vi.mock("../../../components/ModelSelector", () => ({
  allModelOptions: [],
  useModelSelectionOptions: () => ({ modelOption: undefined }),
}));

const { NewVersionFields } = await import("../VersionToBeUsed");

function Harness() {
  const form = useForm({ defaultValues: { version: "", commitMessage: "" } });
  return (
    <ChakraProvider value={defaultSystem}>
      <FormProvider {...form}>
        <NewVersionFields canSaveOverride={true} />
      </FormProvider>
    </ChakraProvider>
  );
}

describe("given the save-version fields are rendered", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  describe("when no Fast model resolves at any scope", () => {
    /** @scenario Opening the save-version drawer with no Fast model fires no generation and no toast */
    it("does not auto-fire generation and shows the sparkles button", async () => {
      mockResolvedDefault.current = null;
      render(<Harness />);

      const sparkles = await screen.findByTestId(
        "generate-commit-message-button",
      );
      expect(sparkles).toBeInTheDocument();
      // Past the effect + debounce window: still no request.
      await new Promise((resolve) => setTimeout(resolve, 30));
      expect(mockGenerateMutate).not.toHaveBeenCalled();
    });

    /** @scenario Clicking the sparkles button without a Fast model surfaces the info toast */
    it("sends the generation request only on sparkles click", async () => {
      mockResolvedDefault.current = null;
      render(<Harness />);

      const sparkles = await screen.findByTestId(
        "generate-commit-message-button",
      );
      fireEvent.click(sparkles);

      // The request fires; the resulting MODEL_NOT_CONFIGURED error is
      // surfaced as the info toast by the global tRPC interceptor
      // (covered in MissingModelToast.integration.test.tsx).
      expect(mockGenerateMutate).toHaveBeenCalledTimes(1);
    });
  });

  describe("when a Fast model resolves for the project", () => {
    /** @scenario A configured Fast model still auto-generates the description */
    it("auto-fires generation and keeps a regenerate button available", async () => {
      mockResolvedDefault.current = { model: "openai/gpt-5-mini" };
      render(<Harness />);

      await waitFor(() => {
        expect(mockGenerateMutate).toHaveBeenCalledTimes(1);
      });
      // The sparkles button stays available as a manual retry / re-roll,
      // not only when no model is configured.
      expect(
        screen.getByTestId("generate-commit-message-button"),
      ).toBeInTheDocument();
    });

    /** @scenario Clicking the sparkles button with a configured model regenerates the description */
    it("re-fires generation when the regenerate button is clicked", async () => {
      mockResolvedDefault.current = { model: "openai/gpt-5-mini" };
      render(<Harness />);

      await waitFor(() => {
        expect(mockGenerateMutate).toHaveBeenCalledTimes(1);
      });

      fireEvent.click(screen.getByTestId("generate-commit-message-button"));
      expect(mockGenerateMutate).toHaveBeenCalledTimes(2);
    });
  });
});
