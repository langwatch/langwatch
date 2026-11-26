import "@testing-library/jest-dom/vitest";
/**
 * The results page shows the agent version a label resolved to and the run's concurrency.
 * @see modules/experiment/specs/experiment-run-recorded-settings.feature
 *
 * @vitest-environment jsdom
 */
import { renderWithDesignSystem } from "@langwatch/design-system/testing";
import { cleanup, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import type { BatchTargetColumn } from "../../batch-evaluation-results.types.ts";
import { type BatchRunSummary, BatchRunsSidebar } from "../batch-runs-sidebar.tsx";
import { BatchTargetHeader } from "../batch-target-header.tsx";

const agentColumn = (overrides: Partial<BatchTargetColumn> = {}): BatchTargetColumn => ({
  id: "target-agent",
  name: "refund-bot",
  type: "agent",
  agentId: "agent-1",
  agentLabel: "production",
  outputFields: ["output"],
  ...overrides,
});

const run = (overrides: Partial<BatchRunSummary> = {}): BatchRunSummary => ({
  runId: "run-1",
  workflowVersion: null,
  timestamps: { createdAt: 1_000, finishedAt: 2_000 },
  summary: { evaluations: {} },
  ...overrides,
});

const pinnedTarget = (version: number | null) => ({
  id: "target-agent",
  name: "refund-bot",
  type: "agent",
  agentLabel: "production",
  agentVersion: version,
});

afterEach(cleanup);

describe("the results table's agent target header", () => {
  describe("given a run whose agent target ran production at version 3", () => {
    /** @scenario "The results page shows the version a label resolved to" */
    it("reads production · v3", () => {
      renderWithDesignSystem(
        <BatchTargetHeader target={agentColumn({ agentVersion: 3 })} aggregates={null} />,
      );

      expect(screen.getByTestId("batch-target-agent-label-target-agent")).toHaveTextContent(
        "production · v3",
      );
    });
  });

  describe("given a run recorded before label versions", () => {
    /** @scenario "A run recorded before label versions shows the label alone" */
    it("reads the label alone", () => {
      renderWithDesignSystem(<BatchTargetHeader target={agentColumn()} aggregates={null} />);

      expect(screen.getByTestId("batch-target-agent-label-target-agent")).toHaveTextContent(
        /^production$/,
      );
    });
  });

  describe("given an agent target running the latest version", () => {
    it("shows no label", () => {
      renderWithDesignSystem(
        <BatchTargetHeader target={agentColumn({ agentLabel: null })} aggregates={null} />,
      );

      expect(screen.queryByTestId("batch-target-agent-label-target-agent")).toBeNull();
    });
  });
});

describe("the run list", () => {
  describe("given runs before and after the label moved, one at concurrency 1", () => {
    /** @scenario "The results page shows the version a label resolved to" */
    /** @scenario "The run summary shows the concurrency the run used" */
    it("reads each run's label version and the concurrency it recorded", () => {
      renderWithDesignSystem(
        <BatchRunsSidebar
          runs={[
            run({ runId: "run-v2", targets: [pinnedTarget(2)], concurrency: 10 }),
            run({
              runId: "run-v3",
              timestamps: { createdAt: 3_000, finishedAt: 4_000 },
              targets: [pinnedTarget(3)],
              concurrency: 1,
            }),
          ]}
          onSelectRun={() => {}}
        />,
      );

      expect(screen.getByTestId("run-agent-label-run-v2-target-agent")).toHaveTextContent(
        "production · v2",
      );
      expect(screen.getByTestId("run-agent-label-run-v3-target-agent")).toHaveTextContent(
        "production · v3",
      );
      expect(screen.getByTestId("run-concurrency-run-v3")).toHaveTextContent(/^Concurrency 1$/);
      expect(screen.getByTestId("run-concurrency-run-v2")).toHaveTextContent(/^Concurrency 10$/);
    });
  });

  describe("given a run that recorded neither", () => {
    /** @scenario "The run summary shows the concurrency the run used" */
    it("shows no label and no concurrency", () => {
      renderWithDesignSystem(<BatchRunsSidebar runs={[run()]} onSelectRun={() => {}} />);

      expect(screen.queryByTestId("run-concurrency-run-1")).toBeNull();
      expect(screen.queryByText(/production/)).toBeNull();
    });
  });

  describe("given runs at concurrency 1 and 10", () => {
    /** @scenario "The concurrency badge explains what it counts" */
    it("describes each run entry with what its concurrency counts", () => {
      renderWithDesignSystem(
        <BatchRunsSidebar
          runs={[
            run({ runId: "run-one", concurrency: 1 }),
            run({
              runId: "run-ten",
              timestamps: { createdAt: 3_000, finishedAt: 4_000 },
              concurrency: 10,
            }),
          ]}
          onSelectRun={() => {}}
        />,
      );

      const entry = (runId: string) =>
        within(screen.getByTestId(`run-item-${runId}`)).getByRole("button");
      expect(entry("run-one")).toHaveAccessibleDescription(
        "Ran one cell at a time. A cell is one row against one target.",
      );
      expect(entry("run-ten")).toHaveAccessibleDescription(
        "Ran up to 10 cells at once. A cell is one row against one target.",
      );
    });
  });

  describe("given a run with four label-pinned agent targets", () => {
    /** @scenario "A run entry with many agent labels stays short" */
    it("shows two label badges and folds the rest into +2", () => {
      const targets = ["a", "b", "c", "d"].map((id, index) => ({
        ...pinnedTarget(index + 1),
        id: `target-${id}`,
        name: `bot-${id}`,
      }));
      renderWithDesignSystem(<BatchRunsSidebar runs={[run({ targets })]} onSelectRun={() => {}} />);

      expect(screen.getByTestId("run-agent-label-run-1-target-a")).toHaveTextContent(
        "production · v1",
      );
      expect(screen.getByTestId("run-agent-label-run-1-target-b")).toBeInTheDocument();
      expect(screen.queryByTestId("run-agent-label-run-1-target-c")).toBeNull();
      const folded = screen.getByTestId("run-agent-labels-folded-run-1");
      expect(folded).toHaveTextContent(/^\+2$/);
      expect(folded).toHaveAttribute("title", "bot-c: production · v3\nbot-d: production · v4");
    });
  });
});
