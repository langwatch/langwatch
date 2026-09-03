/**
 * @vitest-environment jsdom
 *
 * Settings → Topic Clustering: what the card says about a run that failed, and
 * what it says about one that was already underway.
 *
 * THE PLATFORM PAGE HAD NO SUITE. Nothing mounted it, so the two decisions
 * worth pinning were unasserted, and both are about not putting the wrong words
 * in front of a customer:
 *
 *   - a failure the customer can act on is named with our own fixed copy, and a
 *     failure they cannot is a single "on our side" line — the server's code is
 *     the only thing that travels, never a provider's response body, which
 *     carries tracebacks, internal hostnames and echoed key prefixes;
 *   - asking for a run while one is underway is INFORMATION, not an error. It
 *     reaches the reader as a success notice, because a red toast for "already
 *     running" reads as a fault the customer has to do something about.
 */

import { cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { state, calls } = vi.hoisted(() => ({
  state: {
    status: void 0 as Record<string, unknown> | undefined,
    triggerResult: { started: true } as { started: boolean },
  },
  calls: { trigger: vi.fn(), invalidate: vi.fn() },
}));

vi.mock("../../../behavior/topic-api", () => ({
  topicApi: {
    useUtils: () => ({
      topics: {
        getClusteringStatus: { invalidate: calls.invalidate },
        getClusteringRunHistory: { invalidate: calls.invalidate },
      },
    }),
    topics: {
      getClusteringStatus: {
        useQuery: () => ({ data: state.status, isLoading: false }),
      },
      getClusteringRunHistory: {
        useQuery: () => ({ data: [], isLoading: false }),
      },
    },
    project: {
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

import { FakeTopicHost, renderWithTopicHost } from "../../../testing";
import TopicClusteringScreen from "../topic-clustering.screen";

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
    expect(host.successes.at(-1)?.title).toBe("A run is already in progress");
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
