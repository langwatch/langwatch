import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";

import { pollForScenarioRun } from "../pollForScenarioRun";
import { shouldRetryQuery } from "../queryRetryPolicy";

/**
 * Guards the fix for the false "Run timed out" toast.
 *
 * The poll asks the same question with the same parameters up to 60 times.
 * Under the app's default `staleTime: 30_000`, react-query answers attempts
 * 2..60 from the cached response to attempt 1 — so a run that appears a
 * second later is never seen and the poll reports a timeout on a healthy run.
 *
 * These tests drive the real `pollForScenarioRun` against a real QueryClient
 * carrying the real app defaults. Only the network call is faked. Asserting
 * that the hook *passes* `{ staleTime: 0, retry: false }` is not enough — it
 * would keep passing if those options stopped defeating the cache.
 *
 * @see ../pollForScenarioRun.ts
 * @see ../../hooks/useRunScenario.tsx
 */

const POLL_PARAMS = {
  projectId: "project-1",
  scenarioSetId: "set-1",
  batchRunId: "batch-1",
};

/** The query defaults the app installs in `api.tsx`. */
function createAppQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        refetchOnWindowFocus: false,
        networkMode: "always" as const,
        retry: shouldRetryQuery,
      },
    },
  });
}

/**
 * A fetcher whose backing server has no run yet, then has one after
 * `appearsAfterMs`. `fetchOptions` is what the hook hands to tRPC's `.fetch`.
 */
function createCountingFetcher(
  queryClient: QueryClient,
  appearsAfterMs: number,
  fetchOptions: { staleTime?: number; retry?: boolean } = {},
) {
  const counter = { networkCalls: 0 };
  let runExists = false;
  setTimeout(() => {
    runExists = true;
  }, appearsAfterMs);

  const fetcher = (params: typeof POLL_PARAMS) =>
    queryClient.fetchQuery({
      ...fetchOptions,
      queryKey: ["scenarios.getBatchRunData", params],
      queryFn: () => {
        counter.networkCalls++;
        return Promise.resolve({
          changed: true as const,
          runs: runExists
            ? [
                {
                  scenarioRunId: "run_abc",
                  status: "IN_PROGRESS",
                  messages: [],
                },
              ]
            : [],
        });
      },
    });

  return { fetcher, counter };
}

describe("polling against the app's real query cache", () => {
  it("asks the server again on every attempt instead of replaying one cached answer", async () => {
    vi.useFakeTimers();
    try {
      const queryClient = createAppQueryClient();
      const { fetcher, counter } = createCountingFetcher(queryClient, 2000, {
        staleTime: 0,
        retry: false,
      });

      const polling = pollForScenarioRun(fetcher, POLL_PARAMS);
      await vi.advanceTimersByTimeAsync(35_000);

      await expect(polling).resolves.toEqual({
        success: true,
        scenarioRunId: "run_abc",
      });
      expect(counter.networkCalls).toBeGreaterThan(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("would report a false timeout without the cache bypass", async () => {
    vi.useFakeTimers();
    try {
      const queryClient = createAppQueryClient();
      // No fetch options: the app's 30s staleTime applies, which is the bug.
      const { fetcher, counter } = createCountingFetcher(queryClient, 2000);

      const polling = pollForScenarioRun(fetcher, POLL_PARAMS);
      await vi.advanceTimersByTimeAsync(35_000);

      await expect(polling).resolves.toEqual({
        success: false,
        error: "timeout",
      });
      expect(counter.networkCalls).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });
});
