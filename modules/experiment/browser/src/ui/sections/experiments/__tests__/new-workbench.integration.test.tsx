/**
 * @vitest-environment jsdom
 * The new-experiment address creates once and replaces itself with the workbench.
 * See modules/experiment/specs/experiment-entry-redirects.feature.
 */

import { renderWithDesignSystem } from "@langwatch/design-system/testing";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import NewExperimentWorkbench from "../new-workbench.screen.tsx";

const {
  replaceMock,
  createMock,
  alertMock,
  refetchMock,
  routerState,
  datasetState,
  mutationState,
} = vi.hoisted(() => ({
  replaceMock: vi.fn(),
  refetchMock: vi.fn(),
  createMock: vi.fn(),
  alertMock: vi.fn(),
  routerState: { query: {} as Record<string, unknown> },
  /** The mutation's own error state; a rerender reads it, as a state change would. */
  mutationState: { error: undefined as unknown },
  datasetState: {
    error: undefined as unknown,
    data: undefined as
      | {
          name: string;
          columnTypes: { name: string; type: string }[];
          datasetRecords: { id: string; entry: unknown }[];
        }
      | undefined,
  },
}));

// A new router object each call, as the compat shim hands out.
vi.mock("@langwatch/browser-host/use-router", () => ({
  useRouter: () => ({ query: routerState.query, replace: replaceMock }),
}));

vi.mock("@langwatch/browser-host/use-organization-team-project", () => ({
  useOrganizationTeamProject: () => ({ project: { id: "p1", slug: "test-project" } }),
}));

vi.mock("../../../elements/workflow/studio-host/errors.tsx", () => ({
  HandledErrorAlert: ({
    error,
    fallbackTitle,
    onRetry,
  }: {
    error: unknown;
    fallbackTitle: string;
    onRetry?: () => void;
  }) => {
    alertMock(error);
    return (
      <div role="alert">
        {fallbackTitle}
        {onRetry ? <button onClick={onRetry}>Try again</button> : null}
      </div>
    );
  },
}));

vi.mock("../../../../behavior/experiment-api.ts", () => ({
  experimentApi: {
    experiments: {
      saveEvaluationsV3: {
        useMutation: () => ({
          isError: mutationState.error !== undefined,
          error: mutationState.error,
          mutateAsync: async (input: unknown) => {
            try {
              return await createMock(input);
            } catch (failure) {
              mutationState.error = failure;
              throw failure;
            }
          },
        }),
      },
    },
  },
}));
vi.mock("@langwatch/dataset-client", () => ({
  datasetClient: {
    datasetRecord: {
      getAll: {
        useQuery: () => ({
          data: datasetState.data,
          isError: datasetState.error !== undefined,
          error: datasetState.error,
          refetch: refetchMock,
        }),
      },
    },
  },
}));

// Rendered directly: the React Compiler memoises a wrapper's output, so its rerenders stop short.
const renderRepeatedly = () => {
  const view = renderWithDesignSystem(<NewExperimentWorkbench />);
  for (let i = 0; i < 4; i++) view.rerender(<NewExperimentWorkbench />);
  return view;
};

describe("New experiment workbench address", () => {
  afterEach(() => cleanup());
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    routerState.query = {};
    datasetState.data = undefined;
    datasetState.error = undefined;
    mutationState.error = undefined;
  });

  describe("when the experiment is created", () => {
    /** @scenario Opening the new-experiment address creates one experiment and opens its workbench */
    it("creates once and replaces the address with the new workbench", async () => {
      createMock.mockResolvedValue({ slug: "fresh-exp" });

      renderRepeatedly();

      await waitFor(() =>
        expect(replaceMock).toHaveBeenCalledWith("/test-project/experiments/workbench/fresh-exp"),
      );
      expect(replaceMock).toHaveBeenCalledTimes(1);
      expect(createMock).toHaveBeenCalledTimes(1);
      expect(createMock).toHaveBeenCalledWith(
        expect.objectContaining({ projectId: "p1", experimentId: undefined }),
      );
    });
  });

  describe("when a dataset link is opened", () => {
    beforeEach(() => {
      routerState.query = { datasetId: "ds-1" };
    });

    /** @scenario A dataset link waits for its dataset before creating the experiment */
    it("creates nothing while the dataset is loading", () => {
      renderRepeatedly();

      expect(createMock).not.toHaveBeenCalled();
      expect(replaceMock).not.toHaveBeenCalled();
    });

    /** @scenario A dataset link seeds the new experiment with that dataset */
    it("creates the experiment with the saved dataset active", async () => {
      createMock.mockResolvedValue({ slug: "seeded-exp" });
      datasetState.data = {
        name: "Golden set",
        columnTypes: [{ name: "input", type: "string" }],
        datasetRecords: [{ id: "rec-1", entry: { input: "hello" } }],
      };

      renderRepeatedly();

      await waitFor(() =>
        expect(replaceMock).toHaveBeenCalledWith("/test-project/experiments/workbench/seeded-exp"),
      );
      expect(createMock).toHaveBeenCalledTimes(1);
      expect(createMock).toHaveBeenCalledWith(
        expect.objectContaining({
          state: expect.objectContaining({
            activeDatasetId: "saved_ds-1",
            datasets: [
              expect.objectContaining({ id: "saved_ds-1", type: "saved", datasetId: "ds-1" }),
            ],
          }),
        }),
      );
    });
  });

  describe("when the linked dataset fails to load", () => {
    /** @scenario A dataset link whose dataset cannot be loaded says so and offers to try again */
    it("shows the failure with Try again and creates nothing", async () => {
      routerState.query = { datasetId: "ds-1" };
      const failure = Object.assign(new Error("missing"), {
        data: { code: "INTERNAL_SERVER_ERROR" },
      });
      datasetState.error = failure;

      renderRepeatedly();

      expect(await screen.findByRole("alert")).toHaveTextContent(
        "Couldn't load the dataset for this experiment",
      );
      expect(alertMock).toHaveBeenLastCalledWith(failure);
      expect(createMock).not.toHaveBeenCalled();

      fireEvent.click(screen.getByRole("button", { name: "Try again" }));
      expect(refetchMock).toHaveBeenCalledTimes(1);
    });
  });

  describe("when creating the experiment is refused", () => {
    /** @scenario A refused create shows why and stays on the new-experiment address */
    it("shows the refusal and neither navigates nor retries", async () => {
      const refusal = Object.assign(new Error("refused"), { data: { code: "FORBIDDEN" } });
      createMock.mockRejectedValue(refusal);

      const view = renderRepeatedly();
      await waitFor(() => expect(mutationState.error).toBe(refusal));
      view.rerender(<NewExperimentWorkbench />);

      expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't create the experiment");
      expect(alertMock).toHaveBeenLastCalledWith(refusal);
      expect(replaceMock).not.toHaveBeenCalled();
      expect(createMock).toHaveBeenCalledTimes(1);
    });
  });
});
