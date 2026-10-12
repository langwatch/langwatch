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
  /** Every runs call fails. */
  runsError: false,
  /** Experiments whose runs call fails. */
  failing: new Set<string>(),
  /** Experiments whose runs call has not answered yet. */
  held: new Set<string>(),
  run: undefined as unknown,
  /** Every call the runs hook made, with whether it was allowed to fetch. */
  runsCalls: [] as { experimentId: string; enabled: boolean }[],
  /** Whether each experiment's latest runs call was allowed to fetch. */
  enabledNow: new Map<string, boolean>(),
  /** Experiments whose runs were fetched once: what the query cache would still hold. */
  runsCached: new Set<string>(),
  /** The input of every list call. */
  listInputs: [] as { pageOffset?: number; pageSize?: number }[],
  /** The URL's query: the page size the person chose lives here. */
  query: {} as Record<string, string>,
}));
const push = vi.hoisted(() => vi.fn());
const refetch = vi.hoisted(() => vi.fn());
const runsRefetch = vi.hoisted(() => vi.fn());
const runsInvalidate = vi.hoisted(() => vi.fn());

vi.mock("@langwatch/browser-host/use-router", () => ({
  useRouter: () => ({ query: server.query, pathname: "", isReady: true, push }),
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
    useUtils: () => ({
      experiments: { getExperimentBatchEvaluationRuns: { invalidate: runsInvalidate } },
    }),
    experiments: {
      getAllForEvaluationsList: {
        useQuery: (input: { pageOffset?: number; pageSize?: number }) => {
          server.listInputs.push(input);
          return { ...server.list, refetch };
        },
      },
      getExperimentBatchEvaluationRuns: {
        useQuery: ({ experimentId }: { experimentId: string }, options: { enabled: boolean }) => {
          server.runsCalls.push({ experimentId, enabled: options.enabled });
          server.enabledNow.set(experimentId, options.enabled);
          if (options.enabled) server.runsCached.add(experimentId);
          const started = server.runsCached.has(experimentId);
          const pending = started && server.held.has(experimentId);
          const failed = server.runsError || server.failing.has(experimentId);
          const done = started && !pending;
          return {
            isLoading: pending,
            isFetching: pending,
            fetchStatus: pending ? "fetching" : "idle",
            isSuccess: done && !failed,
            isError: done && failed,
            error: done && failed ? new Error("boom") : null,
            refetch: runsRefetch,
            data: done && !failed ? { runs: server.runs[experimentId] ?? [] } : undefined,
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

/** What the newest of the default runs (`r2`) looks like in the list. */
const LATEST = { createdAt: 2000, updatedAt: 2000, finishedAt: 2001 };

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
    latestRun: { timestamps: LATEST },
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
  server.failing = new Set();
  server.held = new Set();
  server.runsCalls = [];
  server.enabledNow = new Map();
  server.runsCached = new Set();
  server.listInputs = [];
  server.query = {};
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
    /** @scenario A closed row draws from the list first and is completed by its runs */
    it("draws the list's own result at once, then completes the row with its runs", () => {
      const many = Array.from({ length: 25 }, (_, index) =>
        listRow({ id: `e${index + 1}`, slug: `exp-${index + 1}`, name: `Experiment ${index + 1}` }),
      );
      server.list.data = { experiments: many, totalHits: 25 };
      server.runs = Object.fromEntries(
        many.map((entry) => [entry.id, [runOf("r1", 1000, 0.7), runOf("r2", 2000, 0.8)]]),
      );
      server.held = new Set(many.map((entry) => entry.id));
      const view = renderWithDesignSystem(<ExperimentsPage />);
      // before any runs call answers, the list alone draws every row
      expect(screen.getAllByText("80.0%")).toHaveLength(25);
      expect(screen.getAllByText("Primary metric:")).toHaveLength(25);
      expect(screen.queryByText(/than run/)).toBeNull();
      server.held = new Set();
      view.rerender(<ExperimentsPage />);
      const asked = server.runsCalls.filter((call) => call.enabled);
      expect(new Set(asked.map((call) => call.experimentId)).size).toBe(25);
      const row = screen.getByTestId("experiment-row-e3");
      expect(within(row).getByText("10.0 pt better")).toBeTruthy();
      expect(within(row).getByText("than run #1")).toBeTruthy();
      expect(within(row).getByText("$0.50")).toBeTruthy();
      expect(within(row).getByRole("button", { name: /Primary metric: correct/ })).toBeTruthy();
      expect(screen.getByRole("columnheader", { name: /Cost, latest run/ })).toBeTruthy();
    });

    /** @scenario A row has one headline, open or closed */
    it("keeps the same headline when opened, and puts the run history in the panel", async () => {
      const user = userEvent.setup({ pointerEventsCheck: 0 });
      renderWithDesignSystem(<ExperimentsPage />);
      const row = screen.getByTestId("experiment-row-e1");
      expect(within(row).getByText("80.0%")).toBeTruthy();
      expect(within(row).getByText("10.0 pt better")).toBeTruthy();
      await user.click(row);
      expect(within(row).getByText("80.0%")).toBeTruthy();
      expect(within(row).getByText("correct", { exact: false })).toBeTruthy();
      const details = screen.getByTestId("experiment-details-e1");
      expect(within(details).getByText("Every run, newest first")).toBeTruthy();
      expect(within(details).getAllByText("$0.50").length).toBeGreaterThan(0);
      expect(within(details).getByText("10.0 pt better")).toBeTruthy();
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
              latestRun: { timestamps: LATEST },
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
              latestRun: { timestamps: LATEST },
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
          ["t1", "t2"].map((targetId) => ({
            index,
            targetId,
            entry: { question: `question ${index}`, expected: "yes" },
            cost: 0.1,
            duration: 50,
          })),
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
      expect(within(details).getByText("Every run, newest first")).toBeTruthy();
      expect(
        within(details).getByRole("button", { name: /Close details of Ticket routing/ }),
      ).toBeTruthy();
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
      expect(within(screen.getByTestId("experiment-row-e1")).getByText("80.0%")).toBeTruthy();
      await user.click(screen.getByRole("button", { name: /Primary metric: correct/ }));
      // the menu explains itself in one line; the reason for the default is in the (i) tip
      expect(screen.getByText("Pick the evaluator this row leads with.")).toBeTruthy();
      expect(within(screen.getByRole("menu")).queryByText(/Shown by default/)).toBeNull();
      await user.click(await screen.findByRole("menuitem", { name: "quality" }));
      expect(within(screen.getByTestId("experiment-row-e1")).getByText("3.50")).toBeTruthy();
      expect(localStorage.getItem("experiments-list-primary-metric")).toContain("project_1/e1");
      // the pick shows on the row at once, and stays when the row is opened and closed
      await user.click(screen.getByTestId("experiment-row-e1"));
      await user.click(screen.getByTestId("experiment-row-e1"));
      expect(within(screen.getByTestId("experiment-row-e1")).getByText("3.50")).toBeTruthy();
      await user.click(
        screen.getByRole("button", { name: "Why this primary metric, and how to change it" }),
      );
      expect(await screen.findByText(/You picked quality/)).toBeTruthy();
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
      const toggle = screen.getByRole("button", { name: "Details of Ticket routing" });
      toggle.focus();
      await user.keyboard("{Enter}");
      expect(screen.getByTestId("experiment-details-e1")).toBeTruthy();
      expect(
        screen
          .getByRole("button", { name: "Details of Ticket routing" })
          .getAttribute("aria-expanded"),
      ).toBe("true");
    });
  });

  describe("when the page loads many rows", () => {
    /** @scenario At most four rows' runs are requested at once */
    it("has only four rows' runs in flight, and asks for the next when one answers", () => {
      const many = Array.from({ length: 25 }, (_, index) =>
        listRow({ id: `e${index + 1}`, slug: `exp-${index + 1}`, name: `Experiment ${index + 1}` }),
      );
      server.list.data = { experiments: many, totalHits: 25 };
      server.held = new Set(many.map((entry) => entry.id));
      const view = renderWithDesignSystem(<ExperimentsPage />);
      const inFlight = () =>
        [...server.enabledNow].filter(([id, enabled]) => enabled && server.held.has(id));
      expect(inFlight().map(([id]) => id)).toEqual(["e1", "e2", "e3", "e4"]);

      server.held.delete("e1");
      view.rerender(<ExperimentsPage />);
      expect(inFlight().map(([id]) => id)).toEqual(["e2", "e3", "e4", "e5"]);
    });

    /** @scenario A failed runs call leaves the row as the list drew it */
    it("keeps a failed row's list result and completes the others", () => {
      server.list.data = {
        experiments: [listRow(), listRow({ id: "e2", slug: "other", name: "Other" })],
        totalHits: 2,
      };
      server.runs = {
        e1: [runOf("r1", 1000, 0.7), runOf("r2", 2000, 0.8)],
        e2: [runOf("r1", 1000, 0.7), runOf("r2", 2000, 0.8)],
      };
      server.failing = new Set(["e1"]);
      renderWithDesignSystem(<ExperimentsPage />);
      const failed = screen.getByTestId("experiment-row-e1");
      expect(within(failed).getByText("80.0%")).toBeTruthy();
      expect(within(failed).queryByRole("button", { name: /Primary metric/ })).toBeNull();
      expect(within(failed).queryByText(/than run/)).toBeNull();
      const fine = screen.getByTestId("experiment-row-e2");
      expect(within(fine).getByRole("button", { name: /Primary metric: correct/ })).toBeTruthy();
    });

    /** @scenario Clicking the name or the menu does not open the row */
    it("does not open a row when the name or the menu is clicked", async () => {
      const user = userEvent.setup({ pointerEventsCheck: 0 });
      renderWithDesignSystem(<ExperimentsPage />);
      await user.click(screen.getByRole("link", { name: "Ticket routing" }));
      await user.click(screen.getByRole("button", { name: "Actions for Ticket routing" }));
      expect(screen.queryByTestId("experiment-details-e1")).toBeNull();
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
              latestRun: { timestamps: LATEST },
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
      const toggle = screen.getByRole("button", { name: "Details of Ticket routing" });
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

describe("given the toolbar above the list", () => {
  const many = [
    listRow({ id: "e1", slug: "tickets", name: "Ticket routing" }),
    listRow({
      id: "e2",
      slug: "summaries",
      name: "Summaries",
      type: "EVALUATIONS_V3",
      dataset: { id: "ds1", name: "tickets-v2" },
    }),
    listRow({ id: "e3", slug: "extraction", name: "Extraction" }),
  ];

  beforeEach(() => {
    server.list.data = { experiments: many, totalHits: 3 };
  });

  describe("when something is typed in the search box", () => {
    /** @scenario Searching loads every experiment once and filters here */
    it("loads every experiment in one call and shows only the matching rows", async () => {
      const user = userEvent.setup({ pointerEventsCheck: 0 });
      renderWithDesignSystem(<ExperimentsPage />);
      expect(server.listInputs.at(-1)).toMatchObject({ pageOffset: 0, pageSize: 25 });
      await user.type(screen.getByRole("searchbox", { name: "Search experiments" }), "tickets");
      expect(server.listInputs.at(-1)).toMatchObject({ pageOffset: 0, pageSize: 10_000 });
      // the name of one and the dataset of another both contain "tickets"
      expect(screen.getByTestId("experiment-row-e1")).toBeTruthy();
      expect(screen.getByTestId("experiment-row-e2")).toBeTruthy();
      expect(screen.queryByTestId("experiment-row-e3")).toBeNull();
      await user.click(screen.getByRole("button", { name: "Reset" }));
      expect(screen.getByTestId("experiment-row-e3")).toBeTruthy();
      expect(server.listInputs.at(-1)).toMatchObject({ pageSize: 25 });
    });

    /** @scenario Searching loads every experiment once and filters here */
    it("says so when nothing matches", async () => {
      const user = userEvent.setup({ pointerEventsCheck: 0 });
      renderWithDesignSystem(<ExperimentsPage />);
      await user.type(screen.getByRole("searchbox", { name: "Search experiments" }), "zzz");
      expect(screen.getByText("No experiments match these filters.")).toBeTruthy();
    });
  });

  describe("when the Ran via filter is used", () => {
    /** @scenario Searching loads every experiment once and filters here */
    it("keeps only the experiments of that kind", async () => {
      const user = userEvent.setup({ pointerEventsCheck: 0 });
      renderWithDesignSystem(<ExperimentsPage />);
      await user.click(screen.getByRole("button", { name: "Ran via: All" }));
      await user.click(await screen.findByRole("menuitemcheckbox", { name: "Workbench" }));
      expect(screen.getByTestId("experiment-row-e2")).toBeTruthy();
      expect(screen.queryByTestId("experiment-row-e1")).toBeNull();
    });
  });

  describe("when rows are grouped by how they ran", () => {
    /** @scenario Rows can be grouped by how they ran */
    it("shows a heading per kind with its count, and a heading collapses its rows", async () => {
      const user = userEvent.setup({ pointerEventsCheck: 0 });
      renderWithDesignSystem(<ExperimentsPage />);
      await user.click(screen.getByText("How it ran"));
      const sdk = screen.getByRole("button", { name: /SDK.*2 experiments/ });
      expect(screen.getByRole("button", { name: /Workbench.*1 experiment/ })).toBeTruthy();
      await user.click(sdk);
      expect(screen.queryByTestId("experiment-row-e1")).toBeNull();
      expect(screen.getByTestId("experiment-row-e2")).toBeTruthy();
    });
  });
});

describe("given an opened row with several targets", () => {
  /** 100 items for one target, `passed` of them passing; the first `errors` fail to answer. */
  const target = ({ id, passed, errors = 0 }: { id: string; passed: number; errors?: number }) => ({
    dataset: Array.from({ length: 100 }, (_, index) => ({
      index,
      targetId: id,
      entry: { question: `question ${index}` },
      cost: 0.01,
      duration: 100,
      ...(index < errors ? { error: "empty output" } : {}),
    })),
    evaluations: Array.from({ length: 100 }, (_, index) => ({
      evaluator: "c",
      targetId: id,
      status: "processed",
      index,
      passed: index < passed,
    })),
  });

  const open = async (targets: { id: string; passed: number; errors?: number }[]) => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    const parts = targets.map(target);
    server.run = {
      experimentId: "e1",
      runId: "r2",
      projectId: "project_1",
      targets: targets.map((entry) => ({
        id: entry.id,
        name: entry.id,
        type: "prompt",
        model: `openai/${entry.id}`,
      })),
      dataset: parts.flatMap((part) => part.dataset),
      evaluations: parts.flatMap((part) => part.evaluations),
    };
    renderWithDesignSystem(<ExperimentsPage />);
    await user.click(screen.getByTestId("experiment-row-e1"));
    return screen.getByTestId("experiment-details-e1");
  };

  /** @scenario An opened row says what the run was tested on */
  it("says what it was tested on, with three example inputs", async () => {
    const details = await open([
      { id: "gpt-a", passed: 90 },
      { id: "gpt-b", passed: 50 },
    ]);
    expect(within(details).getByText("Tested on")).toBeTruthy();
    expect(within(details).getByText(/100 items · fields/)).toBeTruthy();
    expect(within(details).getByText("question")).toBeTruthy();
    expect(within(details).getByText("3 of 100 items, spread across the set")).toBeTruthy();
    expect(within(details).getAllByText(/^question: question \d+$/)).toHaveLength(3);
  });

  /** @scenario A target is compared with the top target in words */
  it("reads points behind the top target, nothing inside the noise, and the errors", async () => {
    const details = await open([
      { id: "gpt-a", passed: 90 },
      { id: "gpt-b", passed: 50, errors: 23 },
      { id: "gpt-c", passed: 89 },
    ]);
    expect(within(details).getByText("vs gpt-a")).toBeTruthy();
    expect(within(details).getByText("40.0 pt behind")).toBeTruthy();
    // gpt-c sits inside the noise of the top: no chip for it
    expect(within(details).queryByText(/39\.0 pt|1\.0 pt behind/)).toBeNull();
    const behind = within(screen.getByTestId("target-row-gpt-b"));
    expect(behind.getByText("23 errors")).toBeTruthy();
    expect(behind.getByText(/“empty output”/)).toBeTruthy();
    expect(within(screen.getByTestId("target-row-gpt-a")).getByText("none")).toBeTruthy();
  });

  /** @scenario A tie is said once above the target table */
  it("says there is no clear winner once, above the table", async () => {
    const details = await open([
      { id: "gpt-a", passed: 90 },
      { id: "gpt-b", passed: 89 },
      { id: "gpt-c", passed: 88 },
    ]);
    expect(within(details).getByText("No clear winner:")).toBeTruthy();
    expect(
      within(details).getByText(/all 3 within noise \(gaps inside the 95% interval\)\./),
    ).toBeTruthy();
    expect(within(details).queryByText("best")).toBeNull();
  });
});

describe("given a workbench run that is still going", () => {
  /** @scenario A running row shows how far it is */
  it("says Running with the cells done of the cells in total", () => {
    const createdAt = Date.now() - 60_000;
    server.list.data = {
      experiments: [
        listRow({
          type: "EVALUATIONS_V3",
          runsSummary: {
            count: 1,
            primaryMetric: { name: "correct", averageScore: 0.8, averagePassed: 0.8 },
            latestRun: { timestamps: { createdAt, updatedAt: Date.now() } },
          },
        }),
      ],
      totalHits: 1,
    };
    server.runs = {
      e1: [
        {
          ...runOf("r1", createdAt, 0.8),
          timestamps: { createdAt, updatedAt: Date.now() },
          progress: 1024,
          total: 1600,
        },
      ],
    };
    renderWithDesignSystem(<ExperimentsPage />);
    const row = screen.getByTestId("experiment-row-e1");
    expect(within(row).getByText("Running")).toBeTruthy();
    expect(within(row).getByText("1,024 of 1,600 cells")).toBeTruthy();
  });
});

describe("given the list is loading", () => {
  /** @scenario The table keeps its header while loading */
  it("keeps the column headers and shows placeholder rows", () => {
    server.list = { isLoading: true, isFetching: true, isError: false, data: undefined };
    const { container } = renderWithDesignSystem(<ExperimentsPage />);
    expect(screen.getByRole("columnheader", { name: "Experiment" })).toBeTruthy();
    expect(screen.getByRole("columnheader", { name: "Last run started" })).toBeTruthy();
    expect(container.querySelectorAll("[data-loading-row]").length).toBeGreaterThan(0);
  });
});

describe("given a run that started on 25 September", () => {
  /** @scenario A row shows its last run's day in short form */
  it("reads the short day", () => {
    const started = new Date(new Date().getFullYear(), 8, 25, 12).getTime();
    server.list.data = {
      experiments: [
        listRow({
          updatedAt: 0,
          runsSummary: { count: 1, latestRun: { timestamps: { createdAt: started } } },
        }),
      ],
      totalHits: 1,
    };
    renderWithDesignSystem(<ExperimentsPage />);
    expect(within(screen.getByTestId("experiment-row-e1")).getByText("Sep 25")).toBeTruthy();
  });

  it("falls back to the experiment's update when it never ran", () => {
    const updated = new Date(new Date().getFullYear(), 8, 25, 12).getTime();
    server.list.data = {
      experiments: [listRow({ updatedAt: updated, runsSummary: { count: 0 } })],
      totalHits: 1,
    };
    renderWithDesignSystem(<ExperimentsPage />);
    expect(within(screen.getByTestId("experiment-row-e1")).getByText("Sep 25")).toBeTruthy();
  });
});

describe("given a row whose runs have not been asked for yet", () => {
  /** @scenario A row waiting for its runs shows a placeholder */
  it("shows a placeholder for the result and the cost, not 'No result yet'", () => {
    const many = Array.from({ length: 6 }, (_, index) =>
      listRow({
        id: `e${index + 1}`,
        slug: `exp-${index + 1}`,
        name: `Experiment ${index + 1}`,
        runsSummary: { count: 2, primaryMetric: null, latestRun: { timestamps: LATEST } },
      }),
    );
    server.list.data = { experiments: many, totalHits: 6 };
    server.held = new Set(many.map((entry) => entry.id));
    renderWithDesignSystem(<ExperimentsPage />);
    // e6 has no slot yet: four are in flight and e5 waits ahead of it
    const waiting = screen.getByTestId("experiment-row-e6");
    expect(within(waiting).queryByText("No result yet")).toBeNull();
    expect(within(waiting).queryByText("–")).toBeNull();
    expect(waiting.querySelectorAll(".chakra-skeleton")).toHaveLength(2);
  });
});

describe("given a closed row whose evaluators report categories only", () => {
  /** @scenario Categories-only evaluators say so */
  it("says there are no numeric results on the row itself", () => {
    server.list.data = {
      experiments: [
        listRow({
          runsSummary: {
            count: 2,
            primaryMetric: { name: "label", averageScore: null },
            latestRun: { timestamps: LATEST },
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
    const row = screen.getByTestId("experiment-row-e1");
    expect(within(row).getByText("No numeric results")).toBeTruthy();
    expect(within(row).queryByText(/No evaluators/)).toBeNull();
  });
});

describe("given a run that was never finished", () => {
  /** @scenario An unfinished run left alone reads Stopped */
  it("reads Stopped, not Finished, once untouched for over five minutes", () => {
    server.list.data = {
      experiments: [
        listRow({
          runsSummary: { count: 1, latestRun: { timestamps: { updatedAt: Date.now() - 600_000 } } },
        }),
      ],
      totalHits: 1,
    };
    renderWithDesignSystem(<ExperimentsPage />);
    const row = screen.getByTestId("experiment-row-e1");
    expect(within(row).getByText("Stopped")).toBeTruthy();
    expect(within(row).queryByText("Finished")).toBeNull();
  });
});

describe("given a closed row whose runs fell behind the list", () => {
  /** @scenario A closed row whose runs fell behind goes back through the slots */
  it("queues the row again instead of refetching it past the slots", () => {
    const view = renderWithDesignSystem(<ExperimentsPage />);
    expect(runsInvalidate).not.toHaveBeenCalled();
    server.list.data = {
      experiments: [
        listRow({
          runsSummary: {
            count: 3,
            primaryMetric: { name: "correct", averageScore: 0.95, averagePassed: 0.95 },
            latestRun: { timestamps: { createdAt: 3000, updatedAt: 3000, finishedAt: 3001 } },
          },
        }),
      ],
      totalHits: 1,
    };
    view.rerender(<ExperimentsPage />);
    expect(runsInvalidate).toHaveBeenCalledTimes(1);
    expect(runsRefetch).not.toHaveBeenCalled();
    view.rerender(<ExperimentsPage />);
    expect(runsInvalidate).toHaveBeenCalledTimes(1);
  });
});

describe("given an opened row that is closed again", () => {
  /** @scenario Closing the panel returns focus to the row's button */
  it("puts focus back on the row's button, with one name throughout", async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    renderWithDesignSystem(<ExperimentsPage />);
    const toggle = screen.getByRole("button", { name: "Details of Ticket routing" });
    await user.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    const details = screen.getByTestId("experiment-details-e1");
    await user.click(
      within(details).getByRole("button", { name: /Close details of Ticket routing/ }),
    );
    expect(screen.queryByTestId("experiment-details-e1")).toBeNull();
    expect(document.activeElement).toBe(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(toggle.getAttribute("aria-label")).toBe("Details of Ticket routing");
  });
});

describe("given a row with a run history", () => {
  /** @scenario The run history sparkline names what it draws */
  it("gives the hidden sparkline a text equivalent with the number of scored runs", () => {
    server.list.data = {
      experiments: [
        listRow({
          runsSummary: {
            count: 3,
            primaryMetric: { name: "correct", averageScore: 0.9, averagePassed: 0.9 },
            latestRun: { timestamps: { createdAt: 3000, updatedAt: 3000, finishedAt: 3001 } },
          },
        }),
      ],
      totalHits: 1,
    };
    server.runs = {
      e1: [runOf("r1", 1000, 0.7), runOf("r2", 2000, 0.8), runOf("r3", 3000, 0.9)],
    };
    renderWithDesignSystem(<ExperimentsPage />);
    const row = screen.getByTestId("experiment-row-e1");
    expect(within(row).getByText("pass rate across 3 scored runs")).toBeTruthy();
    expect(
      row
        .querySelector("polyline[stroke-width='1.5']")
        ?.closest("svg")
        ?.getAttribute("aria-hidden"),
    ).toBe("true");
  });
});

describe("given the Status filter", () => {
  const rows = [
    listRow({
      id: "e1",
      slug: "done",
      name: "Done one",
      runsSummary: { count: 1, latestRun: { timestamps: { finishedAt: NOW } } },
    }),
    listRow({
      id: "e2",
      slug: "going",
      name: "Going one",
      runsSummary: { count: 1, latestRun: { timestamps: { updatedAt: Date.now() } } },
    }),
    listRow({
      id: "e3",
      slug: "cut",
      name: "Cut one",
      runsSummary: { count: 1, latestRun: { timestamps: { stoppedAt: NOW } } },
    }),
    listRow({ id: "e4", slug: "never", name: "Never one", runsSummary: { count: 0 } }),
  ];

  /** @scenario The Status filter narrows the list through the toolbar */
  it("keeps only the experiments in the chosen state, and Reset brings them back", async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    server.list.data = { experiments: rows, totalHits: 4 };
    renderWithDesignSystem(<ExperimentsPage />);
    await user.click(screen.getByRole("button", { name: "Status: All" }));
    await user.click(await screen.findByRole("menuitemcheckbox", { name: "Running" }));
    expect(screen.getByTestId("experiment-row-e2")).toBeTruthy();
    for (const id of ["e1", "e3", "e4"])
      expect(screen.queryByTestId(`experiment-row-${id}`)).toBeNull();
    expect(server.listInputs.at(-1)).toMatchObject({ pageSize: 10_000 });
    await user.keyboard("{Escape}");
    await user.click(screen.getByRole("button", { name: "Status: Running" }));
    await user.click(await screen.findByRole("menuitemcheckbox", { name: "Stopped" }));
    await user.keyboard("{Escape}");
    expect(screen.getByTestId("experiment-row-e3")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Status: 2 selected" })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Reset" }));
    expect(screen.getByTestId("experiment-row-e4")).toBeTruthy();
    expect(server.listInputs.at(-1)).toMatchObject({ pageSize: 25 });
  });
});

describe("given a search with more matches than a page", () => {
  const matches = Array.from({ length: 26 }, (_, index) =>
    listRow({ id: `m${index + 1}`, slug: `match-${index + 1}`, name: `Match ${index + 1}` }),
  );
  const others = [listRow({ id: "o1", slug: "other", name: "Other" })];
  const indicator = () => screen.getByTestId("pagination-indicator").textContent ?? "";

  beforeEach(() => {
    server.list.data = { experiments: [...matches, ...others], totalHits: 27 };
  });

  const search = async (user: ReturnType<typeof userEvent.setup>, text: string) => {
    const box = screen.getByRole("searchbox", { name: "Search experiments" });
    await user.clear(box);
    await user.type(box, text);
  };

  /** @scenario Paging a search happens here and starts over with each new search */
  it("pages the matches here, counts them, and starts at page 1 on a new search", async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    renderWithDesignSystem(<ExperimentsPage />);
    await search(user, "Match");
    expect(indicator()).toContain("26 experiments");
    expect(screen.getAllByTestId(/^experiment-row-/)).toHaveLength(25);
    await user.click(screen.getByTestId("pagination-next"));
    expect(screen.getAllByTestId(/^experiment-row-/)).toHaveLength(1);
    expect(screen.getByTestId("experiment-row-m26")).toBeTruthy();
    await search(user, "Match 1");
    expect(screen.getAllByTestId(/^experiment-row-/).length).toBeGreaterThan(0);
    expect(screen.getByTestId("experiment-row-m1")).toBeTruthy();
    expect(indicator()).toContain("11 experiments");
  });

  /** @scenario Paging a search happens here and starts over with each new search */
  it("returns to the server's paging once the search is reset", async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    renderWithDesignSystem(<ExperimentsPage />);
    await search(user, "Match");
    await user.click(screen.getByTestId("pagination-next"));
    await user.click(screen.getByRole("button", { name: "Reset" }));
    expect(server.listInputs.at(-1)).toMatchObject({ pageOffset: 0, pageSize: 25 });
    expect(screen.getAllByTestId(/^experiment-row-/)).toHaveLength(27);
  });

  /** @scenario Deleting the last row of a filtered page does not leave a blank table */
  it("falls back to the last page when the page it was on empties", async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    const view = renderWithDesignSystem(<ExperimentsPage />);
    await search(user, "Match");
    await user.click(screen.getByTestId("pagination-next"));
    expect(screen.getAllByTestId(/^experiment-row-/)).toHaveLength(1);
    server.list.data = { experiments: [...matches.slice(0, 25), ...others], totalHits: 26 };
    view.rerender(<ExperimentsPage />);
    expect(screen.getAllByTestId(/^experiment-row-/)).toHaveLength(25);
    expect(indicator()).toContain("25 experiments");
  });

  /** @scenario A search keeps the page size the person chose */
  it("pages by the page size chosen in the footer, not a fixed 25", async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    server.query = { pageSize: "10" };
    renderWithDesignSystem(<ExperimentsPage />);
    await search(user, "Match");
    expect(screen.getAllByTestId(/^experiment-row-/)).toHaveLength(10);
    expect((screen.getByTestId("pagination-page-size") as HTMLSelectElement).value).toBe("10");
  });

  /** @scenario A search keeps the page size the person chose */
  it("hands a page size change to the shared footer state", async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    renderWithDesignSystem(<ExperimentsPage />);
    await search(user, "Match");
    await user.selectOptions(screen.getByTestId("pagination-page-size"), "50");
    expect(push).toHaveBeenCalledWith(
      expect.objectContaining({ query: expect.objectContaining({ pageSize: "50" }) }),
      { shallow: true },
    );
  });
});

describe("given a search whose load of every experiment fails", () => {
  /** @scenario A failed search load keeps the toolbar so Reset works */
  it("keeps the toolbar and Reset beside the error", async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    const view = renderWithDesignSystem(<ExperimentsPage />);
    await user.type(screen.getByRole("searchbox", { name: "Search experiments" }), "tickets");
    server.list = { isLoading: false, isFetching: false, isError: true, data: undefined };
    view.rerender(<ExperimentsPage />);
    expect(screen.getByText("Couldn't load experiments")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Reset" }));
    expect(server.listInputs.at(-1)).toMatchObject({ pageSize: 25 });
    expect(screen.queryByRole("button", { name: "Reset" })).toBeNull();
  });
});
