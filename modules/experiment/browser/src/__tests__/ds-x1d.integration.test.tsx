/**
 * @vitest-environment jsdom
 * The DSPy step viewer keeps its blue tabs and grid tables: the Raw switch sits beside (not
 * inside) the tablist with a name, one panel is mounted at a time, and the three step tables'
 * loading, error and empty rows span exactly their columns.
 */

import { renderWithDesignSystem } from "@langwatch/design-system/testing";
import { cleanup, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

type StepQuery = {
  data: { predictors: unknown[]; examples: unknown[]; llm_calls: unknown[] } | undefined;
  isLoading: boolean;
  error: Error | null;
};

const stepData = vi.hoisted(() => ({
  predictors: [
    {
      name: "generate",
      predictor: {
        signature: { signature: "question -> answer", fields: {} },
        extended_signature: { instructions: "Answer\nbriefly" },
        demos: [],
      },
    },
  ],
  examples: [],
  llm_calls: [{ model: "gpt-5", cost: 0.02, response: { output: "Paris", cached: false } }],
}));

const query = vi.hoisted((): { current: StepQuery } => ({
  current: { data: undefined, isLoading: false, error: null },
}));

vi.mock("../behavior/experiment-api.ts", () => ({
  experimentApi: {
    experiments: {
      getExperimentDSPyStep: {
        useQuery: () => query.current,
      },
    },
  },
}));
vi.mock("@langwatch/trace-client", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  RenderInputOutput: ({ value }: { value: string }) => <pre data-testid="raw-json">{value}</pre>,
}));

import { RunDetails } from "../ui/elements/experiments/ds-py-experiment.tsx";

beforeEach(() => {
  query.current = { data: stepData, isLoading: false, error: null };
});
afterEach(cleanup);

const SUMMARY = {
  run_id: "run-1",
  index: "3",
  score: 0.5,
  label: "score",
  optimizer: { name: "MIPROv2" },
  llm_calls_summary: { total: 1, total_tokens: 1200, total_cost: 0.02 },
  timestamps: { created_at: 0 },
};

function renderDetails({ size }: { size?: "md" | "sm" }) {
  return renderWithDesignSystem(
    <RunDetails
      project={{ id: "project-1", slug: "demo", name: "Demo" }}
      experiment={{
        id: "exp-1",
        slug: "dspy-demo",
        name: "DSPy demo",
        type: "DSPY",
        projectId: "project-1",
        workflowId: null,
        createdAt: "2026-10-01T00:00:00.000Z",
        updatedAt: "2026-10-01T00:00:00.000Z",
        archivedAt: null,
        workbenchState: null,
        workbenchVersion: 0,
      }}
      dspyStepSummary={SUMMARY}
      size={size}
    />,
  );
}

/** The panel the selected tab controls; jsdom keeps the inactive ones in the document. */
function activePanel(): HTMLElement {
  const selected = screen.getByRole("tab", { selected: true });
  const panel = document.getElementById(selected.getAttribute("aria-controls") ?? "");
  if (!panel) throw new Error("the selected tab controls no panel");
  return panel;
}

describe("RunDetails step tabs", () => {
  describe("when a step opens", () => {
    it("counts each tab, keeps the grid table and shows the predictors first", () => {
      renderDetails({});

      expect(screen.getAllByRole("tab").map((tab) => tab.textContent)).toEqual([
        "Predictors (1)",
        "Evaluations (0)",
        "LLM Calls (1)",
      ]);
      const table = screen.getByRole("table");
      expect(within(table).getByText("generate")).toBeInTheDocument();
      expect(within(table).getByText(/Answer/)).toHaveStyle({ whiteSpace: "pre-wrap" });
      expect(screen.getByRole("columnheader", { name: "Instructions" })).toBeInTheDocument();
    });

    it("shows one panel at a time", async () => {
      const user = userEvent.setup();
      renderDetails({});

      await user.click(screen.getByRole("tab", { name: "LLM Calls (1)" }));

      const panel = activePanel();
      expect(within(panel).getByText("Paris")).toBeInTheDocument();
      expect(within(panel).queryByText("generate")).not.toBeInTheDocument();
    });
  });

  describe("when the viewer is the full one", () => {
    it("names the Raw switch, keeps it outside the tablist and swaps the table for the JSON", async () => {
      const user = userEvent.setup();
      renderDetails({});

      const raw = screen.getByRole("checkbox", { name: "Raw" });
      expect(within(screen.getByRole("tablist")).queryByRole("checkbox")).toBeNull();
      expect(screen.getByRole("heading", { name: /step 3/ })).toBeInTheDocument();
      await user.click(raw);

      expect(screen.getByTestId("raw-json")).toHaveTextContent("generate");
      expect(screen.queryByRole("table")).not.toBeInTheDocument();

      await user.click(screen.getByRole("tab", { name: "LLM Calls (1)" }));
      expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
      await user.click(screen.getByRole("tab", { name: "Predictors (1)" }));
      expect(screen.getByRole("checkbox", { name: "Raw" })).toBeChecked();
      // The LLM Calls panel unmounts on exit, so it can linger a tick on a slow runner.
      await waitFor(() => expect(screen.getByTestId("raw-json")).toHaveTextContent("generate"));
    });
  });

  describe("when the viewer is the compact one beside the chart", () => {
    it("keeps the step number and totals on the tab strip, with no Raw switch", () => {
      renderDetails({ size: "sm" });

      const tablist = screen.getByRole("tablist");
      expect(within(tablist).getByText("Step 3")).toBeInTheDocument();
      expect(within(tablist).getByText(/Step Tokens:/)).toHaveTextContent("Step Tokens: 1k");
      expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
      expect(screen.queryByRole("heading", { name: /step 3/ })).not.toBeInTheDocument();
    });
  });

  describe("when a step table has nothing to list", () => {
    const columnsOf = (cell: HTMLElement) => cell.closest("td")?.getAttribute("colspan");

    it("spans the five predictor columns when it is empty", () => {
      query.current = { data: { ...stepData, predictors: [] }, isLoading: false, error: null };
      renderDetails({});

      expect(columnsOf(screen.getByText("No entries"))).toBe("5");
    });

    it("spans the four example columns when no example has a trace", async () => {
      const user = userEvent.setup();
      renderDetails({});

      await user.click(screen.getByRole("tab", { name: "Evaluations (0)" }));

      const panel = activePanel();
      expect(columnsOf(within(panel).getByText("No entries"))).toBe("4");
      expect(within(panel).getAllByRole("columnheader")).toHaveLength(4);
    });

    it("spans the five LLM call columns when it is empty or failed", async () => {
      const user = userEvent.setup();
      query.current = { data: { ...stepData, llm_calls: [] }, isLoading: false, error: null };
      const { unmount } = renderDetails({});
      await user.click(screen.getByRole("tab", { name: "LLM Calls (0)" }));
      const panel = activePanel();
      expect(columnsOf(within(panel).getByText("No entries"))).toBe("5");
      expect(within(panel).getAllByRole("columnheader")).toHaveLength(5);
      unmount();

      query.current = { data: undefined, isLoading: false, error: new Error("boom") };
      renderDetails({});
      await user.click(screen.getByRole("tab", { name: /LLM Calls/ }));
      expect(columnsOf(within(activePanel()).getByText("Error loading step data"))).toBe("5");
    });

    it("draws loading rows as wide as the table, with no trace column", async () => {
      const user = userEvent.setup();
      query.current = { data: undefined, isLoading: true, error: null };
      renderDetails({});

      await user.click(screen.getByRole("tab", { name: /Evaluations/ }));
      const rows = within(within(activePanel()).getByRole("table")).getAllByRole("row").slice(1);
      expect(rows).toHaveLength(3);
      for (const row of rows) expect(within(row).getAllByRole("cell")).toHaveLength(4);

      await user.click(screen.getByRole("tab", { name: /LLM Calls/ }));
      const llmRows = within(within(activePanel()).getByRole("table")).getAllByRole("row").slice(1);
      for (const row of llmRows) expect(within(row).getAllByRole("cell")).toHaveLength(5);
    });
  });
});
