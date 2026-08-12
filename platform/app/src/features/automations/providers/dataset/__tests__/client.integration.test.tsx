/**
 * @vitest-environment jsdom
 *
 * specs/automations/list-pages.feature
 *
 * #6716: "+ Create New" in the dataset picker was a no-op
 * (`onCreateNew={() => {}}`) — a project with zero datasets had no way to
 * get one from inside the "add to dataset" automation panel. Mirrors the
 * webhook/slack/email provider client test harness.
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ConfigFormCtx } from "~/features/automations/providers/types";
import datasetClient, { type DatasetSlice } from "../client";

const mockDatasetsRefetch = vi.fn().mockResolvedValue(undefined);
const mockDatasetsData: { current: Array<{ id: string; name: string }> } = {
  current: [],
};

vi.mock("~/utils/api", () => ({
  api: {
    dataset: {
      getAll: {
        useQuery: () => ({
          data: mockDatasetsData.current,
          isLoading: false,
          refetch: mockDatasetsRefetch,
        }),
      },
    },
  },
}));

// The real drawer pulls in tRPC mutations, slug validation, and a full form —
// none of that is what this test is about. Stubbed to a minimal controllable
// surface, matching the pattern in
// `pages/[project]/__tests__/datasets-list.integration.test.tsx`.
vi.mock("~/components/AddOrEditDatasetDrawer", () => ({
  AddOrEditDatasetDrawer: ({
    open,
    onSuccess,
  }: {
    open: boolean;
    onSuccess: (dataset: { datasetId: string }) => void;
  }) =>
    open ? (
      <div data-testid="create-dataset-drawer">
        <button
          type="button"
          onClick={() => onSuccess({ datasetId: "new-dataset-1" })}
        >
          Save new dataset
        </button>
      </div>
    ) : null,
}));

function makeCtx(): ConfigFormCtx {
  return {
    projectId: "project-1",
    organizationId: "org-1",
    teamSlug: "team-1",
    variables: [],
    example: {},
    previewLoading: false,
    cadenceMode: "immediate",
    notificationCadence: "immediate",
    setNotificationCadence: vi.fn(),
    hasEvaluationFilter: false,
    sourceKind: "trace",
  };
}

const Wrapper = ({ children }: { children: React.ReactNode }) => (
  <ChakraProvider value={defaultSystem}>{children}</ChakraProvider>
);

function Harness({
  onChangeSpy,
}: {
  onChangeSpy?: (next: DatasetSlice) => void;
}) {
  const [slice, setSlice] = useState<DatasetSlice>(
    datasetClient.initialSlice(),
  );
  const Form = datasetClient.ConfigForm;
  return (
    <Form
      slice={slice}
      ctx={makeCtx()}
      onChange={(next) => {
        setSlice(next);
        onChangeSpy?.(next);
      }}
    />
  );
}

const renderForm = (onChangeSpy?: (next: DatasetSlice) => void) =>
  render(<Harness onChangeSpy={onChangeSpy} />, { wrapper: Wrapper });

describe("given a project with no datasets yet", () => {
  afterEach(() => {
    cleanup();
    mockDatasetsData.current = [];
    mockDatasetsRefetch.mockClear();
  });

  describe("when the user selects '+ Create New'", () => {
    /** @scenario Creating a dataset inline from a zero-dataset project */
    it("opens a create-dataset drawer without requiring an existing dataset", () => {
      mockDatasetsData.current = [];
      renderForm();

      expect(
        screen.queryByTestId("create-dataset-drawer"),
      ).not.toBeInTheDocument();

      fireEvent.click(screen.getByText("+ Create New"));

      expect(screen.getByTestId("create-dataset-drawer")).toBeInTheDocument();
    });
  });

  describe("when saving the newly created dataset", () => {
    it("selects it in the picker without the author retyping anything", async () => {
      mockDatasetsData.current = [];
      const onChangeSpy = vi.fn();
      renderForm(onChangeSpy);

      fireEvent.click(screen.getByText("+ Create New"));
      fireEvent.click(screen.getByText("Save new dataset"));

      await vi.waitFor(() => {
        expect(mockDatasetsRefetch).toHaveBeenCalled();
      });
      await vi.waitFor(() => {
        expect(onChangeSpy).toHaveBeenCalledWith(
          expect.objectContaining({ datasetId: "new-dataset-1" }),
        );
      });
    });
  });
});
