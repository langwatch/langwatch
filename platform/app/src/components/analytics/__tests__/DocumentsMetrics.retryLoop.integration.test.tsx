/**
 * @vitest-environment jsdom
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { QueryClient } from "@tanstack/react-query";
import {
  act,
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TRPCClientError, type TRPCLink } from "@trpc/client";
import { observable } from "@trpc/server/observable";
import type React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import type { AppRouter } from "~/server/api/root";
import { api } from "~/utils/api";
import { shouldRetryQuery } from "~/utils/queryRetryPolicy";

vi.mock("~/hooks/useFilterParams", () => ({
  useFilterParams: () => ({
    filterParams: {
      projectId: "project-1",
      startDate: 0,
      endDate: 1,
      filters: {},
    },
    queryOpts: { enabled: true, refetchOnMount: false },
  }),
}));

import { DocumentsMetrics } from "../DocumentsMetrics";

const TRACE_ID = "0af7651916cd43dd8448eb211c80319c";

/** Every `analytics.topUsedDocuments` request the page sends. */
let documentRequests = 0;

/** When set, `analytics.topUsedDocuments` answers with it instead of failing. */
let documentsAnswer: unknown;

/** When set, the next answer waits until the test resolves it. */
let holdNextAnswer: Promise<void> | undefined;

/** The handled error the server returns when the search ran out of memory. */
function searchTooLarge() {
  return TRPCClientError.from<AppRouter>({
    error: {
      message: "query_memory_exceeded",
      code: -32600,
      data: {
        code: "UNPROCESSABLE_CONTENT",
        httpStatus: 422,
        error: {
          code: "query_memory_exceeded",
          httpStatus: 422,
          fault: "customer",
          traceId: TRACE_ID,
        },
      },
    },
  });
}

/**
 * A transport where `analytics.topUsedDocuments` fails, or answers with
 * `documentsAnswer` once a test sets it.
 */
const failingLink: TRPCLink<AppRouter> =
  () =>
  ({ op }) =>
    observable((observer) => {
      if (op.path === "analytics.topUsedDocuments") documentRequests++;
      const answer = documentsAnswer;
      const held = holdNextAnswer;
      holdNextAnswer = undefined;
      let open = true;
      // Settle on a later tick, like a real round trip.
      void (held ?? new Promise((resolve) => setTimeout(resolve, 5))).then(
        () => {
          if (!open) return;
          if (answer === undefined) {
            observer.error(searchTooLarge());
            return;
          }
          observer.next({ result: { type: "data", data: answer } });
          observer.complete();
        },
      );
      return () => {
        open = false;
      };
    });

function renderSection(ui: React.ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        refetchOnWindowFocus: false,
        retry: shouldRetryQuery,
      },
    },
  });
  const trpcClient = api.createClient({ links: [failingLink] });

  return render(
    <api.Provider client={trpcClient} queryClient={queryClient}>
      <ChakraProvider value={defaultSystem}>{ui}</ChakraProvider>
    </api.Provider>,
  );
}

async function wait(ms: number) {
  await act(() => new Promise((resolve) => setTimeout(resolve, ms)));
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
      renderSection(<DocumentsMetrics />);
      await screen.findByRole("alert");
      expect(documentRequests).toBe(1);

      await wait(1_500);

      expect(documentRequests).toBe(1);
      expect(screen.getByText("Documents")).toBeInTheDocument();
      expect(
        within(screen.getByRole("alert")).getByText(
          "This search was too large",
        ),
      ).toBeInTheDocument();
      const retry = within(screen.getByRole("alert")).getByRole("button", {
        name: /retry/i,
      });

      const before = documentRequests;
      let release = () => {};
      holdNextAnswer = new Promise((resolve) => {
        release = resolve;
      });
      await userEvent.click(retry);

      // The section and its Retry stay up, loading, while the retry is in flight.
      await waitFor(() => expect(documentRequests).toBe(before + 1));
      expect(screen.getByText("Documents")).toBeInTheDocument();
      // A loading button hides its label, so it is found by its loading state.
      expect(
        screen.getByRole("alert").querySelector("button[data-loading]"),
      ).not.toBeNull();
      await act(async () => release());

      await wait(1_000);

      expect(documentRequests).toBe(before + 1);
      expect(
        within(screen.getByRole("alert")).getByRole("button", {
          name: /retry/i,
        }),
      ).toBeInTheDocument();
    });
  });

  describe("when a Retry after a failure finds no documents", () => {
    it("hides the section", async () => {
      renderSection(<DocumentsMetrics />);
      const alert = await screen.findByRole("alert");

      documentsAnswer = { topDocuments: [], totalUniqueDocuments: 0 };
      await userEvent.click(
        within(alert).getByRole("button", { name: /retry/i }),
      );

      await waitFor(() =>
        expect(screen.queryByText("Documents")).not.toBeInTheDocument(),
      );
    });
  });
});
