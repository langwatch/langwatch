/**
 * @vitest-environment jsdom
 *
 * Settings → Topic Clustering: what the card says about a run that failed vs. one already underway.
 * Actionable failures use fixed copy; "already running" is a success notice, not an error.
 */

import { cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { state, calls } = vi.hoisted(() => ({
  state: {
    status: void 0 as Record<string, unknown> | undefined,
    triggerResult: { started: true } as { started: boolean },
    pages: [{ outcome: "page", entries: [], hasMore: false, nextCursor: null }] as Record<
      string,
      unknown
    >[],
  },
  calls: { trigger: vi.fn(), invalidate: vi.fn(), fetchNextPage: vi.fn() },
}));

vi.mock("../../../behavior/topic-api.ts", () => ({
  topicApi: {
    useUtils: () => ({
      topics: {
        getClusteringStatus: { invalidate: calls.invalidate },
        getClusteringRunHistoryPage: { invalidate: calls.invalidate },
      },
    }),
    topics: {
      getClusteringStatus: {
        useQuery: () => ({ data: state.status, isLoading: false }),
      },
      getClusteringRunHistoryPage: {
        useInfiniteQuery: (
          _input: unknown,
          options: { getNextPageParam: (last: Record<string, unknown>) => unknown },
        ) => {
          const last = state.pages.at(-1);
          return {
            data: { pages: state.pages },
            isLoading: false,
            isError: false,
            isFetchingNextPage: false,
            hasNextPage: last ? options.getNextPageParam(last) !== void 0 : false,
            fetchNextPage: calls.fetchNextPage,
            refetch: vi.fn(),
          };
        },
      },
      triggerTopicClustering: {
        useMutation: (options?: { onSuccess?: (result: { started: boolean }) => void }) => ({
          isPending: false,
          mutate: (input: unknown) => {
            calls.trigger(input);
            options?.onSuccess?.(state.triggerResult);
          },
        }),
      },
    },
  },
}));

import { FakeTopicHost, renderWithTopicHost } from "../../../testing.tsx";
import { MODEL_PROVIDERS_HREF, MODEL_PROVIDERS_LINK_LABEL } from "../topic-clustering-copy.ts";
import TopicClusteringScreen from "../topic-clustering.screen.tsx";

const settledStatus = (overrides: Record<string, unknown>) => ({
  isRunInFlight: false,
  lastRunAt: null,
  lastRunOutcome: null,
  lastRunMode: null,
  lastRunSkippedReason: null,
  lastRunErrorCode: null,
  isLastRunErrorUserActionable: false,
  lastRunTracesProcessed: 0,
  lastRunTopicsCount: 0,
  lastRunSubtopicsCount: 0,
  nextRunAt: null,
  ...overrides,
});

beforeEach(() => {
  vi.clearAllMocks();
  state.status = settledStatus({});
  state.triggerResult = { started: true };
  state.pages = [{ outcome: "page", entries: [], hasMore: false, nextCursor: null }];
});

afterEach(cleanup);

describe("given no project is in scope", () => {
  it("renders nothing rather than a card about nothing", () => {
    const { container } = renderWithTopicHost(
      <TopicClusteringScreen />,
      new FakeTopicHost({ project: null }),
    );

    expect(container.textContent).toBe("");
  });
});

describe("given the last run failed for a reason the customer can fix", () => {
  it("names the reason in our own words", () => {
    state.status = settledStatus({
      lastRunOutcome: "failed",
      lastRunErrorCode: "model_not_configured",
      isLastRunErrorUserActionable: true,
    });

    renderWithTopicHost(<TopicClusteringScreen />);

    expect(screen.getByText("No model is set up for topic clustering")).toBeTruthy();
  });
});

describe("given the last run failed because the only configured model is a restricted Codex model", () => {
  const restrictedRun = {
    runId: "run_1",
    startedAt: Date.now() - 60_000,
    trigger: "manual",
    outcome: "failed",
    mode: null,
    skippedReason: null,
    errorCode: "model_restricted",
    isErrorUserActionable: true,
    tracesProcessed: 0,
    topicsCount: 0,
    subtopicsCount: 0,
  };

  /** @scenario "The settings page shows guidance and a link for a restricted model failure" */
  it("shows the guidance and a link to Model Providers on the status card", () => {
    state.status = settledStatus({
      lastRunOutcome: "failed",
      lastRunErrorCode: "model_restricted",
      isLastRunErrorUserActionable: true,
    });

    renderWithTopicHost(<TopicClusteringScreen />);

    expect(
      screen.getByText("The topic clustering model is not allowed for this feature"),
    ).toBeTruthy();
    expect(
      screen.getByRole("link", { name: MODEL_PROVIDERS_LINK_LABEL }).getAttribute("href"),
    ).toBe(MODEL_PROVIDERS_HREF);
  });

  /** @scenario "The settings page shows guidance and a link for a restricted model failure" */
  it("shows a link to Model Providers on the run history row", () => {
    state.pages = [{ outcome: "page", entries: [restrictedRun], hasMore: false, nextCursor: null }];

    renderWithTopicHost(<TopicClusteringScreen />);

    expect(
      screen.getByRole("link", { name: MODEL_PROVIDERS_LINK_LABEL }).getAttribute("href"),
    ).toBe(MODEL_PROVIDERS_HREF);
  });
});

describe("given the last run failed for a reason the customer cannot fix", () => {
  it("says so once and offers no action", () => {
    state.status = settledStatus({
      lastRunOutcome: "failed",
      lastRunErrorCode: "unexpected",
      isLastRunErrorUserActionable: false,
    });

    renderWithTopicHost(<TopicClusteringScreen />);

    expect(screen.getByText(/failed on our side/i)).toBeTruthy();
  });
});

describe("when a run is asked for while one is already underway", () => {
  it("reports it as information rather than as a failure", () => {
    state.triggerResult = { started: false };
    const { host } = renderWithTopicHost(<TopicClusteringScreen />);

    fireEvent.click(screen.getByRole("button", { name: /run topic clustering/i }));

    expect(host.failures).toHaveLength(0);
    expect(host.successes).toHaveLength(0);
    expect(host.infos.at(-1)?.title).toBe("A run is already in progress");
  });
});

describe("when a run is asked for and starts", () => {
  it("asks for the project in scope and says the run began", () => {
    const { host } = renderWithTopicHost(<TopicClusteringScreen />);

    fireEvent.click(screen.getByRole("button", { name: /run topic clustering/i }));

    expect(calls.trigger).toHaveBeenCalledWith({ projectId: "project-1" });
    expect(host.successes.at(-1)?.title).toBe("Topic clustering started");
  });
});

describe("given the last run completed without finding any topic", () => {
  it("says no new topics were found instead of organizing into zero", () => {
    state.status = settledStatus({ lastRunOutcome: "completed", lastRunTracesProcessed: 51 });

    renderWithTopicHost(<TopicClusteringScreen />);

    expect(screen.getByText(/found no new topics in 51 traces/i)).toBeTruthy();
    expect(screen.queryByText(/into 0 topics/i)).toBeNull();
  });
});

const run = (runId: string, overrides: Record<string, unknown> = {}) => ({
  runId,
  startedAt: Date.now() - 60_000,
  trigger: "scheduled",
  outcome: "completed",
  mode: "incremental",
  skippedReason: null,
  errorCode: null,
  isErrorUserActionable: false,
  tracesProcessed: 12,
  topicsCount: 2,
  subtopicsCount: 3,
  ...overrides,
});

describe("given a run history with no runs", () => {
  it("names what makes the first run and links the topic clustering docs", () => {
    renderWithTopicHost(<TopicClusteringScreen />);

    expect(screen.getByText(/no runs yet/i)).toBeTruthy();
    expect(screen.getByRole("link", { name: /about topic clustering/i }).getAttribute("href")).toBe(
      "https://docs.langwatch.ai/features/topic-clustering",
    );
  });
});

describe("given a run history with more runs than one page", () => {
  it("asks the server for the next page from Load more", () => {
    state.pages = [
      { outcome: "page", entries: [run("run-1")], hasMore: true, nextCursor: "run-1" },
    ];
    renderWithTopicHost(<TopicClusteringScreen />);

    fireEvent.click(screen.getByRole("button", { name: "Load more" }));

    expect(calls.fetchNextPage).toHaveBeenCalledTimes(1);
  });

  it("shows every loaded page in order and ends without the button", () => {
    state.pages = [
      { outcome: "page", entries: [run("run-1")], hasMore: true, nextCursor: "run-1" },
      { outcome: "page", entries: [run("run-2")], hasMore: false, nextCursor: null },
    ];
    renderWithTopicHost(<TopicClusteringScreen />);

    expect(screen.getAllByRole("row")).toHaveLength(3);
    expect(screen.queryByRole("button", { name: "Load more" })).toBeNull();
  });
});

describe("given the history moved past the reader's place", () => {
  it("says so and offers the newest runs instead of Load more", () => {
    state.pages = [
      { outcome: "page", entries: [run("run-1")], hasMore: true, nextCursor: "run-1" },
      { outcome: "cursor_expired" },
    ];
    renderWithTopicHost(<TopicClusteringScreen />);

    expect(screen.getByText(/history moved on/i)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Show newest runs" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Load more" })).toBeNull();
  });
});
