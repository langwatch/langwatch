/**
 * @vitest-environment jsdom
 * @see modules/experiment/specs/experiment-list-page.feature
 */
import { defineSlice } from "@langwatch/browser-host/global-store";
import { renderWithDesignSystem } from "@langwatch/design-system/testing";
import { WORKFLOW_HOST_SLICE, type WorkflowHostSlice } from "@langwatch/workflow-contract";
import { cleanup, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const server = vi.hoisted(() => ({
  list: { isLoading: false, isFetching: false, isError: false, data: undefined as unknown },
  runs: {} as Record<string, unknown>,
  runsError: false,
  run: undefined as unknown,
  /** Every call the runs hook made, with whether it was allowed to fetch. */
  runsCalls: [] as { experimentId: string; enabled: boolean }[],
  /** Experiments whose runs were fetched once: what the query cache would still hold. */
  runsCached: new Set<string>(),
}));
const push = vi.hoisted(() => vi.fn());
const refetch = vi.hoisted(() => vi.fn());
const runsRefetch = vi.hoisted(() => vi.fn());

vi.mock("@langwatch/browser-host/use-router", () => ({
  useRouter: () => ({ query: {}, pathname: "", isReady: true, push }),
}));
vi.mock("@langwatch/browser-host/use-organization-team-project", () => ({
  useOrganizationTeamProject: () => ({ project: { id: "project_1", slug: "proj" } }),
}));
vi.mock("../../../../behavior/experiments/use-copy-experiment.ts", () => ({
  useCopyExperiment: () => ({ copyExperimentTo: vi.fn(), isCopying: false }),
}));
vi.mock("../../../../behavior/experiments/use-create-experiment.ts", () => ({
  useCreateExperiment: () => ({ createNewExperiment: vi.fn(), isCreating: false }),
}));
vi.mock("../../../../behavior/experiment-api.ts", () => ({
  experimentApi: {
    experiments: {
      getAllForEvaluationsList: { useQuery: () => ({ ...server.list, refetch }) },
      getExperimentBatchEvaluationRuns: {
        useQuery: ({ experimentId }: { experimentId: string }, options: { enabled: boolean }) => {
          server.runsCalls.push({ experimentId, enabled: options.enabled });
          if (options.enabled) server.runsCached.add(experimentId);
          const loaded = server.runsCached.has(experimentId);
          return {
            isLoading: false,
            isError: loaded && server.runsError,
            error: loaded && server.runsError ? new Error("boom") : null,
            refetch: runsRefetch,
            data:
              loaded && !server.runsError ? { runs: server.runs[experimentId] ?? [] } : undefined,
          };
        },
      },
      getExperimentBatchEvaluationRun: {
        useQuery: (_input: unknown, options: { enabled: boolean }) => ({
          isLoading: false,
          isError: false,
          refetch: vi.fn(),
          data: options.enabled ? server.run : undefined,
        }),
      },
      deleteExperiment: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
    },
  },
}));

import ExperimentsPage from "../experiments.screen.tsx";

const NOW = Date.now();

const summary = (passed: number, cost = 0.5) => ({
  datasetCost: cost,
  evaluationsCost: 0,
  evaluations: { c: { name: "correct", averageScore: passed, averagePassed: passed } },
});
const runOf = (id: string, createdAt: number, passed: number) => ({
  experimentId: "e1",
  runId: id,
  workflowVersion: null,
  timestamps: { createdAt, updatedAt: createdAt, finishedAt: createdAt + 1 },
  summary: summary(passed),
});

const listRow = (overrides: Record<string, unknown> = {}) => ({
  id: "e1",
  slug: "tickets",
  name: "Ticket routing",
  type: "BATCH_EVALUATION_V2",
  createdAt: NOW,
  updatedAt: NOW,
  workflowId: null,
  workflow: null,
  runsSummary: {
    count: 2,
    primaryMetric: { name: "correct", averageScore: 0.8, averagePassed: 0.8 },
    latestRun: { timestamps: { finishedAt: NOW } },
  },
  ...overrides,
});

function publishWorkflowHost(permissions: Record<string, boolean>) {
  const nothing = () => void 0;
  defineSlice<WorkflowHostSlice>({
    name: WORKFLOW_HOST_SLICE,
    create: () => ({
      scope: () => ({ projectId: "project_1", projectSlug: "proj" }),
      hasPermission: (permission: string) => permissions[permission] ?? false,
      copyTargets: () => [],
      route: () => ({ params: {}, query: {} }),
      setQuery: nothing,
      navigate: nothing,
      back: nothing,
      succeeded: nothing,
      warned: nothing,
      informed: nothing,
      failed: nothing,
    }),
  });
}

beforeEach(() => {
  localStorage.clear();
  server.list = {
    isLoading: false,
    isFetching: false,
    isError: false,
    data: { experiments: [listRow()], totalHits: 1 },
  };
  server.runsError = false;
  server.runsCalls = [];
  server.runsCached = new Set();
  server.runs = { e1: [runOf("r1", 1000, 0.7), runOf("r2", 2000, 0.8)] };
  server.run = undefined;
  publishWorkflowHost({
    "workflows:create": true,
    "evaluations:manage": true,
    "workflows:delete": true,
  });
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("given the experiments list", () => {
  describe("when the project has experiments", () => {
    /** @scenario A closed row shows the list's own result and asks for nothing more */
    it("shows the list's own result on a closed row, without asking for the runs", () => {
      renderWithDesignSystem(<ExperimentsPage />);
      expect(screen.getByText("80.0%")).toBeTruthy();
      expect(screen.getByText("correct")).toBeTruthy();
      expect(screen.queryByText(/than run/)).toBeNull();
      expect(server.runsCalls.filter((call) => call.enabled)).toEqual([]);
    });

    /** @scenario A row has one headline, open or closed */
    it("keeps the same headline when opened, and puts the change in words in the panel", async () => {
      const user = userEvent.setup({ pointerEventsCheck: 0 });
      renderWithDesignSystem(<ExperimentsPage />);
      const row = screen.getByTestId("experiment-row-e1");
      expect(within(row).getByText("80.0%")).toBeTruthy();
      await user.click(row);
      expect(within(row).getByText("80.0%")).toBeTruthy();
      expect(within(row).getByText("correct")).toBeTruthy();
      expect(within(row).queryByText(/than run/)).toBeNull();
      const details = screen.getByTestId("experiment-details-e1");
      expect(within(details).getAllByText("10.0 pt better than run #1").length).toBeGreaterThan(0);
      const asked = server.runsCalls.filter((call) => call.enabled);
      expect(new Set(asked.map((call) => call.experimentId))).toEqual(new Set(["e1"]));
      const costHeaders = screen.getAllByRole("columnheader", { name: /Cost/ });
      expect(costHeaders.every((header) => details.contains(header))).toBe(true);
      expect(within(details).getAllByText("$0.5000").length).toBeGreaterThan(0);
    });

    /** @scenario A row has one headline, open or closed */
    it("has no cost column", () => {
      renderWithDesignSystem(<ExperimentsPage />);
      expect(screen.queryByRole("columnheader", { name: /Cost/ })).toBeNull();
    });

    /** @scenario Closing a row never leaves a stale headline */
    it("keeps the headline when a loaded row is closed again", async () => {
      const user = userEvent.setup({ pointerEventsCheck: 0 });
      renderWithDesignSystem(<ExperimentsPage />);
      await user.click(screen.getByTestId("experiment-row-e1"));
      await user.click(screen.getByTestId("experiment-row-e1"));
      expect(screen.queryByTestId("experiment-details-e1")).toBeNull();
      expect(within(screen.getByTestId("experiment-row-e1")).getByText("80.0%")).toBeTruthy();
    });

    /** @scenario Closing a row never leaves a stale headline */
    it("shows the fresh list value after open, close and a list refetch", async () => {
      const user = userEvent.setup({ pointerEventsCheck: 0 });
      const view = renderWithDesignSystem(<ExperimentsPage />);
      await user.click(screen.getByTestId("experiment-row-e1"));
      await user.click(screen.getByTestId("experiment-row-e1"));
      server.list.data = {
        experiments: [
          listRow({
            runsSummary: {
              count: 3,
              primaryMetric: { name: "correct", averageScore: 0.95, averagePassed: 0.95 },
              latestRun: { timestamps: { finishedAt: NOW } },
            },
          }),
        ],
        totalHits: 1,
      };
      view.rerender(<ExperimentsPage />);
      expect(within(screen.getByTestId("experiment-row-e1")).getByText("95.0%")).toBeTruthy();
    });

    /** @scenario An open panel refetches when the list has moved past its runs */
    it("refetches an open panel whose cached runs the list has moved past", async () => {
      const user = userEvent.setup({ pointerEventsCheck: 0 });
      const view = renderWithDesignSystem(<ExperimentsPage />);
      await user.click(screen.getByTestId("experiment-row-e1"));
      expect(runsRefetch).not.toHaveBeenCalled();
      server.list.data = {
        experiments: [
          listRow({
            runsSummary: {
              count: 3,
              primaryMetric: { name: "correct", averageScore: 0.95, averagePassed: 0.95 },
              latestRun: { timestamps: { finishedAt: NOW } },
            },
          }),
        ],
        totalHits: 1,
      };
      view.rerender(<ExperimentsPage />);
      expect(runsRefetch).toHaveBeenCalledTimes(1);
      view.rerender(<ExperimentsPage />);
      expect(runsRefetch).toHaveBeenCalledTimes(1);
    });

    /** @scenario The experiment's name leads to its page in the same tab */
    it("links the name to the results page in the same tab", () => {
      renderWithDesignSystem(<ExperimentsPage />);
      const link = screen.getByRole("link", { name: "Ticket routing" });
      expect(link.getAttribute("href")).toBe("/proj/experiments/tickets");
      expect(link.getAttribute("target")).toBeNull();
    });

    /** @scenario The experiment's name leads to its page in the same tab */
    it("links a workbench experiment's name to the workbench", () => {
      server.list.data = { experiments: [listRow({ type: "EVALUATIONS_V3" })], totalHits: 1 };
      renderWithDesignSystem(<ExperimentsPage />);
      expect(screen.getByRole("link", { name: "Ticket routing" }).getAttribute("href")).toBe(
        "/proj/experiments/workbench/tickets",
      );
    });
  });

  describe("when a row knows its dataset", () => {
    /** @scenario A row shows its dataset only when one is recorded */
    it("names it under the experiment", () => {
      server.list.data = {
        experiments: [listRow({ dataset: { id: "ds1", name: "tickets-v2" } })],
        totalHits: 1,
      };
      renderWithDesignSystem(<ExperimentsPage />);
      expect(screen.getByText("tickets-v2")).toBeTruthy();
    });

    /** @scenario A row shows its dataset only when one is recorded */
    it("shows no dataset line when none is recorded", () => {
      renderWithDesignSystem(<ExperimentsPage />);
      expect(screen.queryByText("Dataset")).toBeNull();
    });
  });

  describe("when a row is clicked", () => {
    /** @scenario Clicking a row opens it inline without leaving the list */
    it("opens it inline and does not navigate", async () => {
      const user = userEvent.setup({ pointerEventsCheck: 0 });
      server.run = {
        experimentId: "e1",
        runId: "r2",
        projectId: "project_1",
        targets: [
          { id: "t1", name: "gpt", type: "prompt", model: "openai/gpt-5" },
          { id: "t2", name: "claude", type: "prompt", model: "anthropic/claude-x" },
        ],
        dataset: [0, 1].flatMap((index) =>
          ["t1", "t2"].map((targetId) => ({ index, targetId, entry: {}, cost: 0.1, duration: 50 })),
        ),
        evaluations: [0, 1].flatMap((index) => [
          { evaluator: "c", targetId: "t1", status: "processed", index, passed: true },
          { evaluator: "c", targetId: "t2", status: "processed", index, passed: index === 0 },
        ]),
      };
      renderWithDesignSystem(<ExperimentsPage />);
      await user.click(screen.getByTestId("experiment-row-e1"));
      const details = screen.getByTestId("experiment-details-e1");
      expect(within(details).getByText("gpt-5")).toBeTruthy();
      expect(within(details).getByText("claude-x")).toBeTruthy();
      expect(within(details).getByText("Every run")).toBeTruthy();
      expect(push).not.toHaveBeenCalled();
    });
  });

  describe("when the primary metric is changed", () => {
    /** @scenario The primary metric defaults by rule and can be changed per experiment */
    it("keeps the pick in this browser and leads with it", async () => {
      const user = userEvent.setup({ pointerEventsCheck: 0 });
      server.runs = {
        e1: [runOf("r1", 1000, 0.8), runOf("r2", 2000, 0.8)].map((run) => ({
          ...run,
          summary: {
            evaluations: {
              c: { name: "correct", averageScore: 0.8, averagePassed: 0.8 },
              q: { name: "quality", averageScore: 3.5 },
            },
          },
        })),
      };
      renderWithDesignSystem(<ExperimentsPage />);
      await user.click(screen.getByTestId("experiment-row-e1"));
      expect(within(screen.getByTestId("experiment-row-e1")).getByText("80.0%")).toBeTruthy();
      await user.click(screen.getByRole("button", { name: /Primary metric: correct/ }));
      expect(screen.getByText(/Shown by default/)).toBeTruthy();
      await user.click(await screen.findByRole("menuitem", { name: "quality" }));
      expect(within(screen.getByTestId("experiment-row-e1")).getByText("3.50")).toBeTruthy();
      expect(localStorage.getItem("experiments-list-primary-metric")).toContain("project_1/e1");
      // the pick shows on the row at once, and stays when the row is closed
      await user.click(screen.getByTestId("experiment-row-e1"));
      expect(within(screen.getByTestId("experiment-row-e1")).getByText("3.50")).toBeTruthy();
    });
  });

  describe("when the actions menu is open", () => {
    /** @scenario Every row action keeps working */
    it("does not toggle the row when its padding is clicked", async () => {
      const user = userEvent.setup({ pointerEventsCheck: 0 });
      renderWithDesignSystem(<ExperimentsPage />);
      await user.click(screen.getByRole("button", { name: "Actions for Ticket routing" }));
      const menu = await screen.findByRole("menu");
      await user.click(menu);
      expect(screen.queryByTestId("experiment-details-e1")).toBeNull();
    });
  });

  describe("when the row is used by keyboard", () => {
    /** @scenario The chevron button is the keyboard path */
    it("opens with Enter on the labelled chevron, and the row itself is not a tab stop", async () => {
      const user = userEvent.setup({ pointerEventsCheck: 0 });
      renderWithDesignSystem(<ExperimentsPage />);
      expect(screen.getByTestId("experiment-row-e1").getAttribute("tabindex")).toBeNull();
      const toggle = screen.getByRole("button", { name: "Open Ticket routing" });
      toggle.focus();
      await user.keyboard("{Enter}");
      expect(screen.getByTestId("experiment-details-e1")).toBeTruthy();
      expect(
        screen.getByRole("button", { name: "Close Ticket routing" }).getAttribute("aria-expanded"),
      ).toBe("true");
    });
  });

  describe("when the page loads many rows", () => {
    /** @scenario A closed row shows the list's own result and asks for nothing more */
    it("asks for no experiment's runs until a row is opened", async () => {
      const user = userEvent.setup({ pointerEventsCheck: 0 });
      const many = Array.from({ length: 25 }, (_, index) =>
        listRow({ id: `e${index + 1}`, slug: `exp-${index + 1}`, name: `Experiment ${index + 1}` }),
      );
      server.list.data = { experiments: many, totalHits: 25 };
      renderWithDesignSystem(<ExperimentsPage />);
      expect(screen.getAllByText("80.0%")).toHaveLength(25);
      expect(screen.getAllByText("correct")).toHaveLength(25);
      expect(server.runsCalls.length).toBeGreaterThan(0);
      expect(server.runsCalls.filter((call) => call.enabled)).toEqual([]);

      await user.click(screen.getByTestId("experiment-row-e7"));
      const fetching = server.runsCalls.filter((call) => call.enabled);
      expect(new Set(fetching.map((call) => call.experimentId))).toEqual(new Set(["e7"]));
    });

    /** @scenario Clicking the name or the menu does not open the row */
    it("does not open a row, or ask for its runs, when the name or the menu is clicked", async () => {
      const user = userEvent.setup({ pointerEventsCheck: 0 });
      renderWithDesignSystem(<ExperimentsPage />);
      await user.click(screen.getByRole("link", { name: "Ticket routing" }));
      await user.click(screen.getByRole("button", { name: "Actions for Ticket routing" }));
      expect(screen.queryByTestId("experiment-details-e1")).toBeNull();
      expect(server.runsCalls.filter((call) => call.enabled)).toEqual([]);
    });

    /** @scenario Clicking the name or the menu does not open the row */
    it("does not open a row when its dataset link is clicked", async () => {
      const user = userEvent.setup({ pointerEventsCheck: 0 });
      server.list.data = {
        experiments: [listRow({ dataset: { id: "ds1", name: "tickets-v2" } })],
        totalHits: 1,
      };
      renderWithDesignSystem(<ExperimentsPage />);
      await user.click(screen.getByRole("link", { name: "tickets-v2" }));
      expect(screen.queryByTestId("experiment-details-e1")).toBeNull();
    });
  });

  describe("when a row has never run", () => {
    beforeEach(() => {
      server.list.data = {
        experiments: [listRow({ runsSummary: { count: 0, primaryMetric: null } })],
        totalHits: 1,
      };
    });

    it("marks the empty values and says there are no runs when opened, without asking for any", async () => {
      const user = userEvent.setup({ pointerEventsCheck: 0 });
      renderWithDesignSystem(<ExperimentsPage />);
      const row = screen.getByTestId("experiment-row-e1");
      expect(row.querySelectorAll("[data-empty-value]").length).toBeGreaterThanOrEqual(2);
      await user.click(row);
      expect(
        within(screen.getByTestId("experiment-details-e1")).getByText("No runs yet."),
      ).toBeTruthy();
      expect(server.runsCalls.filter((call) => call.enabled)).toEqual([]);
    });
  });

  describe("when the latest run is running or stopped", () => {
    it("says Running for a recent unfinished run", () => {
      server.list.data = {
        experiments: [
          listRow({
            runsSummary: { count: 1, latestRun: { timestamps: { updatedAt: Date.now() } } },
          }),
        ],
        totalHits: 1,
      };
      renderWithDesignSystem(<ExperimentsPage />);
      expect(within(screen.getByTestId("experiment-row-e1")).getByText("Running")).toBeTruthy();
    });

    it("says Stopped for a stopped run", () => {
      server.list.data = {
        experiments: [
          listRow({
            runsSummary: { count: 1, latestRun: { timestamps: { stoppedAt: NOW } } },
          }),
        ],
        totalHits: 1,
      };
      renderWithDesignSystem(<ExperimentsPage />);
      expect(within(screen.getByTestId("experiment-row-e1")).getByText("Stopped")).toBeTruthy();
    });
  });

  describe("when the runs of an opened row fail to load", () => {
    /** @scenario A failed runs request is an error, not an empty result */
    it("shows an error, not 'no scored runs', and keeps the list's result", async () => {
      const user = userEvent.setup({ pointerEventsCheck: 0 });
      server.runsError = true;
      renderWithDesignSystem(<ExperimentsPage />);
      await user.click(screen.getByTestId("experiment-row-e1"));
      const details = screen.getByTestId("experiment-details-e1");
      expect(within(details).getByText("Couldn't load the runs of this experiment")).toBeTruthy();
      expect(within(details).queryByText("No scored runs yet.")).toBeNull();
      expect(screen.getByText("80.0%")).toBeTruthy();
    });
  });

  describe("when a row is opened with no score in any run", () => {
    it("says no scored runs", async () => {
      const user = userEvent.setup({ pointerEventsCheck: 0 });
      server.runs = { e1: [{ ...runOf("r1", 1000, 0.8), summary: { evaluations: {} } }] };
      renderWithDesignSystem(<ExperimentsPage />);
      await user.click(screen.getByTestId("experiment-row-e1"));
      expect(
        within(screen.getByTestId("experiment-details-e1")).getByText("No scored runs yet."),
      ).toBeTruthy();
    });
  });

  describe("when every evaluator reports categories only", () => {
    /** @scenario Categories-only evaluators say so */
    it("says there are no numeric results, not that nothing was scored", async () => {
      const user = userEvent.setup({ pointerEventsCheck: 0 });
      server.list.data = {
        experiments: [
          listRow({
            runsSummary: {
              count: 2,
              primaryMetric: { name: "label", averageScore: null },
              latestRun: { timestamps: { finishedAt: NOW } },
            },
          }),
        ],
        totalHits: 1,
      };
      server.runs = {
        e1: [runOf("r1", 1000, 0.8), runOf("r2", 2000, 0.8)].map((run) => ({
          ...run,
          summary: { evaluations: { k: { name: "label", averageScore: null } } },
        })),
      };
      renderWithDesignSystem(<ExperimentsPage />);
      await user.click(screen.getByTestId("experiment-row-e1"));
      const details = screen.getByTestId("experiment-details-e1");
      expect(within(details).getByText(/No numeric results/)).toBeTruthy();
      expect(within(details).queryByText("No scored runs yet.")).toBeNull();
    });
  });

  describe("when the table is read by a screen reader", () => {
    it("names the first header cell and the open control", () => {
      renderWithDesignSystem(<ExperimentsPage />);
      expect(screen.getByRole("columnheader", { name: "Open or close the row" })).toBeTruthy();
      const toggle = screen.getByRole("button", { name: "Open Ticket routing" });
      expect(toggle.getAttribute("aria-expanded")).toBe("false");
    });
  });

  describe("when the row menu is used", () => {
    /** @scenario Every row action keeps working */
    it("offers every action the person has permission for", async () => {
      const user = userEvent.setup({ pointerEventsCheck: 0 });
      renderWithDesignSystem(<ExperimentsPage />);
      await user.click(screen.getByRole("button", { name: "Actions for Ticket routing" }));
      expect(await screen.findByText("View results")).toBeTruthy();
      expect(screen.getByText("Replicate to another project")).toBeTruthy();
      expect(screen.getByText("Delete")).toBeTruthy();
    });

    /** @scenario Every row action keeps working */
    it("offers Edit and View results for a workbench experiment", async () => {
      server.list.data = { experiments: [listRow({ type: "EVALUATIONS_V3" })], totalHits: 1 };
      const user = userEvent.setup({ pointerEventsCheck: 0 });
      renderWithDesignSystem(<ExperimentsPage />);
      await user.click(screen.getByRole("button", { name: "Actions for Ticket routing" }));
      expect(await screen.findByText("Edit")).toBeTruthy();
      expect(screen.getByText("View results")).toBeTruthy();
    });

    /** @scenario Every row action keeps working */
    it("hides replicate and delete without their permissions", async () => {
      publishWorkflowHost({});
      const user = userEvent.setup({ pointerEventsCheck: 0 });
      renderWithDesignSystem(<ExperimentsPage />);
      await user.click(screen.getByRole("button", { name: "Actions for Ticket routing" }));
      expect(await screen.findByText("View results")).toBeTruthy();
      expect(screen.queryByText("Replicate to another project")).toBeNull();
      expect(screen.queryByText("Delete")).toBeNull();
    });

    /** @scenario Every row action keeps working */
    it("asks before deleting", async () => {
      const user = userEvent.setup({ pointerEventsCheck: 0 });
      renderWithDesignSystem(<ExperimentsPage />);
      await user.click(screen.getByRole("button", { name: "Actions for Ticket routing" }));
      await user.click(await screen.findByText("Delete"));
      expect(
        await screen.findByText(/Are you sure you want to delete the experiment "Ticket routing"/),
      ).toBeTruthy();
    });
  });

  describe("when there is nothing to list", () => {
    /** @scenario An empty project and a failed load say so */
    it("shows the empty state with create", () => {
      publishWorkflowHost({ "experiments:update": true });
      server.list.data = { experiments: [], totalHits: 0 };
      renderWithDesignSystem(<ExperimentsPage />);
      expect(screen.getByText("No experiments yet")).toBeTruthy();
      expect(screen.getByText("New experiment")).toBeTruthy();
    });

    /** @scenario An empty project and a failed load say so */
    it("says so when loading fails", () => {
      server.list = { ...server.list, isError: true, data: undefined };
      renderWithDesignSystem(<ExperimentsPage />);
      expect(screen.getByText("Couldn't load experiments")).toBeTruthy();
    });
  });
});
