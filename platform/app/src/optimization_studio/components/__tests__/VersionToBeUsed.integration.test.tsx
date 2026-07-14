/**
 * @vitest-environment jsdom
 *
 * The version description in the Evaluate dialog is required, but the red
 * "required" ring must not appear until the user actually attempts to
 * submit - a customer disliked opening the dialog to an already-red field
 * they had not touched.
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import type { ReactNode } from "react";
import { FormProvider, useForm } from "react-hook-form";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("~/hooks/useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: () => ({ project: { id: "proj-1" } }),
}));

vi.mock("~/optimization_studio/hooks/useWorkflowStore", () => ({
  useWorkflowStore: (selector: (state: unknown) => unknown) =>
    selector({
      checkCanCommitNewVersion: () => true,
      getWorkflow: () => ({ nodes: [], edges: [] }),
    }),
}));

vi.mock("~/optimization_studio/components/History", () => ({
  useVersionState: () => ({
    previousVersion: { dsl: { nodes: [], edges: [] }, version: "2" },
    nextVersion: "3",
  }),
}));

vi.mock("~/components/ModelSelector", () => ({
  allModelOptions: [],
  useModelSelectionOptions: () => ({ modelOption: { isDisabled: false } }),
}));

vi.mock("~/utils/api", () => ({
  api: {
    modelProvider: {
      getResolvedDefault: {
        // A configured model so the field renders without the sparkles path.
        useQuery: () => ({
          data: { model: "openai/gpt-5-mini" },
          isFetched: true,
        }),
      },
    },
    workflow: {
      generateCommitMessage: {
        useMutation: () => ({ mutate: vi.fn(), isLoading: false }),
      },
    },
  },
}));

const { VersionToBeUsed } = await import("../VersionToBeUsed");

function Harness({ children }: { children: ReactNode }) {
  const form = useForm<{ version: string; commitMessage: string }>({
    defaultValues: { version: "", commitMessage: "" },
  });
  return (
    <ChakraProvider value={defaultSystem}>
      <FormProvider {...form}>
        <form
          // eslint-disable-next-line @typescript-eslint/no-misused-promises
          onSubmit={form.handleSubmit(() => undefined)}
        >
          {children}
          <button type="submit">Submit</button>
        </form>
      </FormProvider>
    </ChakraProvider>
  );
}

describe("given the Evaluate dialog version fields", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  describe("when the dialog has just opened", () => {
    it("does not mark the empty description field invalid", () => {
      const { container } = render(
        <Harness>
          <VersionToBeUsed />
        </Harness>,
      );

      const description = screen.getByPlaceholderText(
        "What changes have you made?",
      );
      expect(description).toHaveValue("");
      // Chakra's Field.Root marks the field with data-invalid when invalid.
      expect(container.querySelector("[data-invalid]")).toBeNull();
    });
  });

  describe("when the user submits with the description still empty", () => {
    it("marks the description field invalid", async () => {
      render(
        <Harness>
          <VersionToBeUsed />
        </Harness>,
      );

      fireEvent.click(screen.getByRole("button", { name: "Submit" }));

      // Validation resolves asynchronously after the submit attempt.
      await waitFor(() => {
        const description = screen.getByPlaceholderText(
          "What changes have you made?",
        );
        expect(description.closest("[data-invalid]")).not.toBeNull();
      });
    });
  });
});
