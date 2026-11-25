/**
 * @vitest-environment jsdom
 *
 * The bar over the table once the run behind the eval chip failed: why, and Retry.
 * @see specs/traces-v2/instant-eval-search.feature
 */
import { DesignSystemProvider } from "@langwatch/design-system/provider";
import { instantEvalRunKey } from "@langwatch/trace-contract";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../../behavior/use-organization-team-project.ts", () => ({
  useOrganizationTeamProject: () => ({ project: { id: "project-1" } }),
}));
vi.mock("../../../../behavior/writes/use-trace-writes.ts", () => ({
  useCancelInstantEval: () => ({ mutate: vi.fn() }),
}));

import { useExplorerStore } from "../../../../behavior/explorer.store.ts";
import { useSearchSubmitRequestStore } from "../../../../features/explorer/behavior/search-submit-request.store.ts";
import { useInstantEvalRunStore } from "../../../../features/instant-eval/behavior/instant-eval-run.store.ts";
import { InstantEvalProgressBanner } from "../instant-eval-progress-banner.tsx";

const wrapper = ({ children }: { children: ReactNode }) => (
  <DesignSystemProvider forcedTheme="light">{children}</DesignSystemProvider>
);

const QUERY = 'service:api AND eval:"the user is annoyed"';
const key = instantEvalRunKey({
  question: "the user is annoyed",
  target: "traces",
  otherQuery: "service:api",
  window: { from: 1_000, to: 2_000 },
});

beforeEach(() => {
  useExplorerStore.getState().clearAll();
  useExplorerStore.setState({
    queryText: QUERY,
    debouncedQueryText: QUERY,
    debouncedTimeRange: { from: 1_000, to: 2_000 },
    evalRuns: { [key]: "run-1" },
    activeLensId: "all-traces",
  });
  useSearchSubmitRequestStore.setState({ request: null });
  useInstantEvalRunStore.setState({ runs: {}, stoppedByUser: {}, quiet: {}, settled: {} });
  useInstantEvalRunStore.getState().setRun({
    id: "run-1",
    status: "failed",
    total: 8,
    progress: 0,
    matched: null,
    failed: 0,
    skipped: 0,
    error: "connect_unreachable",
    priceUsd: 0,
    finishedAtMs: Date.now(),
  });
});

afterEach(() => cleanup());

describe("given a run behind the query's eval chip that LangWatch could not reach", () => {
  /** @scenario "A run that fails on the server shows the failure instead of judging" */
  it("shows why it failed with Retry, and no judging bar", () => {
    render(<InstantEvalProgressBanner />, { wrapper });

    expect(screen.getByTestId("instant-eval-failure").textContent).toContain(
      "Instant Evals could not reach LangWatch. Nothing was charged.",
    );
    expect(screen.getByRole("button", { name: "Retry" })).toBeTruthy();
    expect(screen.queryByTestId("instant-eval-progress")).toBeNull();
  });

  describe("when a later chip's run has settled", () => {
    /** @scenario "A failed chip keeps its bar when a later chip has settled" */
    it("still shows the earlier chip's failure with Retry", () => {
      const query = `${QUERY} AND eval:"the user is happy"`;
      const laterKey = instantEvalRunKey({
        question: "the user is happy",
        target: "traces",
        otherQuery: "service:api",
        window: { from: 1_000, to: 2_000 },
      });
      useExplorerStore.setState({
        queryText: query,
        debouncedQueryText: query,
        evalRuns: { [key]: "run-1", [laterKey]: "run-2" },
      });
      useInstantEvalRunStore.getState().setRun({
        id: "run-2",
        status: "finished",
        total: 8,
        progress: 8,
        matched: 3,
        failed: 0,
        skipped: 0,
        error: null,
        priceUsd: 0.01,
        finishedAtMs: Date.now(),
      });
      useInstantEvalRunStore.setState({ settled: { "run-2": true } });

      render(<InstantEvalProgressBanner />, { wrapper });

      expect(screen.getByTestId("instant-eval-failure")).toBeTruthy();
      expect(screen.getByRole("button", { name: "Retry" })).toBeTruthy();
    });
  });

  describe("when Retry is pressed", () => {
    /** @scenario "Retry starts the same eval again" */
    it("forgets the failed run and submits the query again", () => {
      render(<InstantEvalProgressBanner />, { wrapper });

      fireEvent.click(screen.getByRole("button", { name: "Retry" }));

      expect(useExplorerStore.getState().evalRuns).toEqual({});
      expect(useSearchSubmitRequestStore.getState().request?.text).toBe(QUERY);
    });
  });
});
