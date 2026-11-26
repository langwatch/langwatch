/**
 * Real Chromium: a large run's results page, in a column like the shell's page body, keeps its
 * table bounded so only the rows in view are drawn. Spec: experiment-results-large-runs.feature
 */

import { renderWithDesignSystem } from "@langwatch/design-system/testing";
import type { ExperimentRunWithItems } from "@langwatch/experiment-contract";
import { cleanup, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";

const ROWS = 2_000;
const EVALUATORS = ["exact_match", "llm_judge", "toxicity"];

const largeRun = {
  experimentId: "experiment-1",
  runId: "run-1",
  projectId: "project-1",
  repeat: null,
  targets: [{ id: "target-a", name: "support-prompt", type: "prompt" }],
  dataset: Array.from({ length: ROWS }, (_, index) => ({
    index,
    targetId: "target-a",
    entry: { question: `Customer ${index} asks about the refund policy. `.repeat(3) },
    predicted: { output: `Refunds are accepted within 30 days for order ${index}. `.repeat(4) },
    cost: 0.0012,
    duration: 900,
  })),
  evaluations: Array.from({ length: ROWS }, (_, index) =>
    EVALUATORS.map((evaluator) => ({
      evaluator,
      name: evaluator,
      targetId: "target-a",
      index,
      status: "processed" as const,
      score: (index % 10) / 10,
      passed: index % 3 !== 0,
    })),
  ).flat(),
  timestamps: { createdAt: 1_000, updatedAt: 2_000, finishedAt: 2_000 },
  completeness: {
    complete: true,
    dataset: { received: ROWS, expected: ROWS },
    evaluations: { received: ROWS * 3, expected: ROWS * 3 },
  },
} as ExperimentRunWithItems;

const experiment = {
  id: "experiment-1",
  name: "Refund answers",
  slug: "refund-answers",
  type: "BATCH_EVALUATION_V2",
  projectId: "project-1",
  workflowId: null,
  workbenchState: null,
};

const answered = (data: unknown) => ({
  data,
  error: null,
  isError: false,
  isLoading: false,
  isFetching: false,
  isSuccess: true,
  refetch: vi.fn(),
});

/** Every read the page makes, answered from the fixtures above; an unlisted enabled read throws. */
const readsByProcedure: Record<string, (input: { runId?: string }) => unknown> = {
  getExperimentBySlugOrId: () => experiment,
  getExperimentBatchEvaluationRuns: () => ({
    runs: [
      {
        runId: "run-1",
        workflowVersion: null,
        timestamps: largeRun.timestamps,
        progress: ROWS,
        total: ROWS,
        summary: { evaluations: {} },
      },
    ],
  }),
  getExperimentBatchEvaluationRun: ({ runId }) => (runId === "run-1" ? largeRun : undefined),
};

const readOf = (procedure: string, input: { runId?: string }): unknown => {
  const read = readsByProcedure[procedure];
  if (!read) throw new Error(`experiment page test: no fixture for the ${procedure} read`);
  return read(input);
};

const procedureOf = (procedure: string) => ({
  useQuery: (input: { runId?: string }, options?: { enabled?: boolean }) =>
    answered(options?.enabled === false ? undefined : readOf(procedure, input)),
  useMutation: () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false }),
  useSubscription: () => undefined,
});

vi.mock("../../../../behavior/experiment-api.ts", () => ({
  experimentApi: new Proxy(
    { useUtils: () => new Proxy({}, { get: () => ({ invalidate: vi.fn() }) }) },
    {
      get: (target, namespace: string) =>
        namespace === "useUtils"
          ? target.useUtils
          : new Proxy({}, { get: (_inner, procedure: string) => procedureOf(procedure) }),
    },
  ),
}));
vi.mock("../../../../behavior/batch-evaluation-results/use-run-dataset-versions.ts", () => ({
  useRunDatasetVersions: () => ({}),
}));
vi.mock("../../../../behavior/batch-evaluation-results/use-show-comparison-leaderboard.ts", () => ({
  useShowComparisonLeaderboard: () => false,
}));
vi.mock("../../../../behavior/lent-trace.tsx", () => ({
  TraceIdPeek: () => null,
  RenderInputOutput: () => null,
}));
vi.mock("@langwatch/browser-host/drawer", () => ({
  useDrawer: () => ({ openDrawer: vi.fn(), closeDrawer: vi.fn() }),
}));
vi.mock("@langwatch/browser-host/use-organization-team-project", () => ({
  useOrganizationTeamProject: () => ({ project: { id: "project-1", slug: "web-app" } }),
}));
vi.mock("@langwatch/browser-host/use-router", () => ({
  useRouter: () => ({
    isReady: true,
    pathname: "/[project]/experiments/[experiment]",
    query: { project: "web-app", experiment: "refund-answers" },
    push: vi.fn(),
    replace: vi.fn(),
  }),
}));

import ExperimentPage from "../experiment-detail.screen.tsx";

afterEach(() => cleanup());

/** The app shell's page body: a bounded column that scrolls, as the navigation module draws it. */
const ShellPageBody = ({ children }: { children: React.ReactNode }) => (
  <div style={{ display: "flex", height: 720, overflow: "hidden" }}>
    <div style={{ display: "flex", flexDirection: "column", width: "100%", minHeight: 0 }}>
      <div
        style={{
          flex: 1,
          minHeight: 0,
          width: "100%",
          display: "flex",
          flexDirection: "column",
          overflowY: "auto",
        }}
      >
        {children}
      </div>
    </div>
  </div>
);

const drawnRows = (container: HTMLElement) => container.querySelectorAll("tbody tr[data-index]");

describe("the results page of a large run", () => {
  describe("given a finished run of 2,000 rows scored by three evaluators", () => {
    /** @scenario "The results page of a large run draws only the rows in view" */
    it("draws only the rows in view, and the next ones on scroll", async () => {
      await page.viewport(1440, 900);
      const { container } = renderWithDesignSystem(
        <ShellPageBody>
          <ExperimentPage />
        </ShellPageBody>,
      );

      await waitFor(() => expect(drawnRows(container).length).toBeGreaterThan(0));
      expect(drawnRows(container).length).toBeLessThan(100);
      expect(container.querySelector('tbody tr[data-index="1500"]')).toBeNull();

      const scroller = container.querySelector("table")?.parentElement;
      expect(scroller).toBeTruthy();
      scroller!.scrollTop = scroller!.scrollHeight / 2;
      scroller!.dispatchEvent(new Event("scroll"));

      await waitFor(() => {
        expect(container.querySelector('tbody tr[data-index="0"]')).toBeNull();
        const indexes = [...drawnRows(container)].map((row) =>
          Number(row.getAttribute("data-index")),
        );
        expect(indexes.some((index) => index > 500)).toBe(true);
      });
      expect(drawnRows(container).length).toBeGreaterThan(0);
      expect(drawnRows(container).length).toBeLessThan(100);
    });
  });
});
