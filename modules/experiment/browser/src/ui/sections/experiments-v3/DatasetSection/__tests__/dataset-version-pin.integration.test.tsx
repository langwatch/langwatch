/**
 * The dataset header pins the saved dataset version the experiment's runs read.
 * @see specs/experiments-v3/dataset-version-pin.feature
 * @vitest-environment jsdom
 */
import { renderWithDesignSystem } from "@langwatch/design-system/testing";
import { cleanup, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useEvaluationsV3Store } from "../../../../../behavior/experiments-v3/use-evaluations-v3-store.ts";
import type { DatasetReference } from "../../../../../model/experiments-v3/types.ts";
import { DatasetTabs } from "../dataset-tabs.tsx";

const versionsQuery = vi.fn();

vi.mock("@langwatch/browser-host/use-organization-team-project", () => ({
  useOrganizationTeamProject: () => ({ project: { id: "project-1", slug: "project-1" } }),
}));

vi.mock("@langwatch/dataset-client", () => ({
  datasetClient: {
    dataset: {
      versions: {
        useQuery: (input: unknown, options: unknown) => versionsQuery(input, options),
      },
    },
  },
}));

const handlers = {
  onSelectExisting: vi.fn(),
  onUploadCSV: vi.fn(),
  onEditDataset: vi.fn(),
  onSaveAsDataset: vi.fn(),
};

const savedDataset = (datasetVersion?: number): DatasetReference => ({
  id: "ds-ref",
  name: "Questions",
  type: "saved",
  datasetId: "dataset-1",
  ...(datasetVersion !== undefined ? { datasetVersion } : {}),
  columns: [{ id: "question", name: "question", type: "string" }],
  savedRecords: [],
});

const attach = (dataset: DatasetReference) =>
  useEvaluationsV3Store.setState({ datasets: [dataset], activeDatasetId: dataset.id });

const activeDatasetVersion = () =>
  useEvaluationsV3Store.getState().datasets.find((dataset) => dataset.id === "ds-ref")
    ?.datasetVersion;

const versionItem = () => screen.findByTestId("experiment-dataset-version");
const badge = () => screen.queryByTestId("experiment-dataset-version-badge");

const openVersions = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.click(screen.getByTestId("dataset-tab-ds-ref"));
  await user.click(await versionItem());
  return screen.findAllByRole("menuitemradio");
};

describe("DatasetTabs dataset version pin", () => {
  beforeEach(() => {
    useEvaluationsV3Store.getState().reset();
    versionsQuery.mockReturnValue({
      data: {
        restorable: true,
        versions: [
          { version: 1, name: null },
          { version: 2, name: "cleaned" },
        ],
      },
      isLoading: false,
    });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  describe("given an experiment whose saved dataset has versions 1 and 2", () => {
    /** @scenario "The dataset version select lists Latest and every version, newest first" */
    it("shows Latest and lists the versions newest first", async () => {
      const user = userEvent.setup();
      attach(savedDataset());
      renderWithDesignSystem(<DatasetTabs {...handlers} />);

      expect(badge()).not.toBeInTheDocument();
      const labels = (await openVersions(user)).map((option) => option.textContent);
      expect(await versionItem()).toHaveTextContent("Dataset version (Latest)");
      expect(labels).toEqual(["Latest version", "Version 2 · cleaned", "Version 1"]);
      expect(versionsQuery).toHaveBeenCalledWith(
        { projectId: "project-1", datasetId: "dataset-1" },
        expect.objectContaining({ enabled: true }),
      );
    });

    describe("when version 1 is chosen", () => {
      /** @scenario "Choosing a version pins the experiment to it" */
      it("pins the saved dataset reference to version 1", async () => {
        const user = userEvent.setup();
        attach(savedDataset());
        renderWithDesignSystem(<DatasetTabs {...handlers} />);

        await openVersions(user);
        await user.click(screen.getByRole("menuitemradio", { name: "Version 1" }));

        expect(activeDatasetVersion()).toBe(1);
        expect(badge()).toHaveTextContent("v1");
      });
    });
  });

  describe("given an experiment pinned to version 1", () => {
    describe("when Latest is chosen", () => {
      /** @scenario "Choosing Latest removes the pin" */
      it("clears the pin from the saved dataset reference", async () => {
        const user = userEvent.setup();
        attach(savedDataset(1));
        renderWithDesignSystem(<DatasetTabs {...handlers} />);
        expect(badge()).toHaveTextContent("v1");

        await openVersions(user);
        await user.click(screen.getByRole("menuitemradio", { name: "Latest version" }));

        expect(activeDatasetVersion()).toBeUndefined();
        expect(badge()).not.toBeInTheDocument();
      });
    });
  });

  describe("given an experiment whose active dataset is inline", () => {
    /** @scenario "An inline dataset offers no version select" */
    it("offers no dataset version menu and reads no versions", async () => {
      const user = userEvent.setup();
      renderWithDesignSystem(<DatasetTabs {...handlers} />);
      const tab = screen.getAllByTestId(/^dataset-tab-/)[0]!;
      await user.click(tab);

      expect(await screen.findByRole("menuitem", { name: /Switch Dataset/ })).toBeInTheDocument();
      expect(screen.queryByTestId("experiment-dataset-version")).not.toBeInTheDocument();
      expect(versionsQuery).not.toHaveBeenCalled();
    });
  });
});
