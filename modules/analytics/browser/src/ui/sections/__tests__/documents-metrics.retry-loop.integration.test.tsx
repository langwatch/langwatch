/** @vitest-environment jsdom */

/**
 * A failed documents section stays on screen with its Retry and sends no request on its own:
 * its panels mounting under the failed query must not refetch it, since a refetch of a query
 * with no data clears the error and the section would hide, unmount the panels and fail again.
 */

import { createUiQueryClient } from "@langwatch/browser/query-client";
import {
  answeringUiTransport,
  type UiProcedureAnswer,
  UiProcedureRefusal,
} from "@langwatch/browser/testing-transport";
import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

vi.mock("../../../behavior/use-filter-params.ts", () => ({
  useFilterParams: () => ({
    filterParams: { projectId: "proj-1", startDate: 0, endDate: 1, filters: {} },
    queryOpts: { enabled: true, refetchOnMount: false, refetchOnWindowFocus: false },
  }),
}));

import { analyticsApi } from "../../../behavior/analytics-api.ts";
import { AnalyticsTestHarness, StubAnalyticsHost } from "../../../testing.tsx";
import { DocumentsMetrics } from "../documents-metrics.tsx";

/** Every `analytics.topUsedDocuments` request the section sends. */
let documentRequests = 0;

/** When set, `analytics.topUsedDocuments` answers with it instead of failing. */
let documentsAnswer: unknown;

/** When set, the next answer waits until the test resolves it. */
let holdNextAnswer: Promise<void> | undefined;

const answer: UiProcedureAnswer = async ({ path }) => {
  if (path !== "analytics.topUsedDocuments") throw new Error(`No test answer for ${path}`);
  documentRequests++;
  const answered = documentsAnswer;
  const held = holdNextAnswer;
  holdNextAnswer = undefined;
  await (held ?? new Promise((resolve) => setTimeout(resolve, 5)));
  if (answered === undefined) throw new UiProcedureRefusal("query_memory_exceeded", 422);
  return answered;
};

function renderSection() {
  const queryClient = createUiQueryClient({ onMutationError: () => void 0 });
  return render(
    <AnalyticsTestHarness host={new StubAnalyticsHost()}>
      <analyticsApi.Provider client={answeringUiTransport(answer)} queryClient={queryClient}>
        <DocumentsMetrics />
      </analyticsApi.Provider>
    </AnalyticsTestHarness>,
  );
}

async function wait(ms: number) {
  await act(() => new Promise((resolve) => setTimeout(resolve, ms)));
}

function retryButton() {
  return within(screen.getByRole("alert")).getByRole("button", { name: /retry/i });
}

afterEach(cleanup);

beforeEach(() => {
  documentRequests = 0;
  documentsAnswer = undefined;
  holdNextAnswer = undefined;
});

describe("<DocumentsMetrics />", () => {
  describe("when the documents query always fails with a handled error", () => {
    /** @scenario "A failed documents section stays visible and does not refetch on its own" */
    it("keeps the error and its Retry on screen without refetching, and Retry sends one request", async () => {
      renderSection();
      await screen.findByRole("alert");
      expect(documentRequests).toBe(1);

      await wait(1_500);

      expect(documentRequests).toBe(1);
      expect(screen.getByText("Documents")).toBeInTheDocument();
      expect(
        within(screen.getByRole("alert")).getByText("This search was too large"),
      ).toBeInTheDocument();

      const before = documentRequests;
      let release = () => {};
      holdNextAnswer = new Promise((resolve) => {
        release = resolve;
      });
      await userEvent.click(retryButton());

      // The section and its Retry stay up, loading, while the retry is in flight.
      await waitFor(() => expect(documentRequests).toBe(before + 1));
      expect(screen.getByText("Documents")).toBeInTheDocument();
      // A loading button hides its label, so it is found by its loading state.
      expect(screen.getByRole("alert").querySelector("button[data-loading]")).not.toBeNull();
      await act(async () => release());

      await wait(1_000);

      expect(documentRequests).toBe(before + 1);
      expect(retryButton()).toBeInTheDocument();
    });
  });

  describe("when a Retry after a failure finds no documents", () => {
    it("hides the section", async () => {
      renderSection();
      await screen.findByRole("alert");

      documentsAnswer = { topDocuments: [], totalUniqueDocuments: 0 };
      await userEvent.click(retryButton());

      await waitFor(() => expect(screen.queryByText("Documents")).not.toBeInTheDocument());
    });
  });
});
