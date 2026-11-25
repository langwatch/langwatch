/**
 * @vitest-environment jsdom
 * @see modules/scenario/specs/scenario-stream-reconciliation.feature
 */
import { ScenarioRunStatus } from "@langwatch/scenario-contract";
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { StreamingEventPayload } from "../../use-simulation-streaming-state.ts";
import { useRunStateStream } from "../use-run-state-stream.ts";

type RunState = {
  status: ScenarioRunStatus;
  messages: { id: string; role: string; content: string }[];
};

const mocks = vi.hoisted(() => ({
  runState: undefined as RunState | undefined,
  onStreamingEvent: undefined as ((payload: StreamingEventPayload) => void) | undefined,
}));

vi.mock("@langwatch/scenario-client", () => ({
  scenarioClient: {
    scenarios: {
      getRunState: {
        useQuery: () => ({
          data: mocks.runState,
          error: null,
          isLoading: false,
        }),
      },
    },
  },
}));

vi.mock("../../use-simulation-update-listener.ts", () => ({
  useSimulationUpdateListener: ({
    onStreamingEvent,
  }: {
    onStreamingEvent: (payload: StreamingEventPayload) => void;
  }) => {
    mocks.onStreamingEvent = onStreamingEvent;
    return { isConnected: true };
  },
}));

const frames: FrameRequestCallback[] = [];

function flushFrames() {
  act(() => {
    const pending = frames.splice(0);
    for (const cb of pending) cb(performance.now());
  });
}

function send(payload: Omit<StreamingEventPayload, "b">) {
  act(() => mocks.onStreamingEvent?.({ b: "batch_1", ...payload }));
  flushFrames();
}

function renderStream(scenarioRunId: string) {
  return renderHook(
    ({ runId }: { runId: string }) =>
      useRunStateStream({
        scenarioRunId: runId,
        projectId: "project_1",
        isOpen: true,
      }),
    { initialProps: { runId: scenarioRunId } },
  );
}

function previewIds(result: { current: ReturnType<typeof useRunStateStream> }) {
  return result.current.streamingMessages.map((m) => m.messageId);
}

describe("useRunStateStream()", () => {
  beforeEach(() => {
    frames.length = 0;
    vi.spyOn(globalThis, "requestAnimationFrame").mockImplementation((cb) => {
      frames.push(cb);
      return frames.length;
    });
    vi.spyOn(globalThis, "cancelAnimationFrame").mockImplementation(() => {});
    mocks.runState = {
      status: ScenarioRunStatus.IN_PROGRESS,
      messages: [{ id: "m0", role: "user", content: "hi" }],
    };
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  describe("when the drawer re-renders", () => {
    it("keeps one store and starts no timer while nothing is buffered", () => {
      vi.useFakeTimers();
      try {
        const { rerender, unmount } = renderStream("run_a");
        rerender({ runId: "run_a" });
        rerender({ runId: "run_a" });
        expect(vi.getTimerCount()).toBe(0);

        send({ e: "C", r: "run_a", m: "early", d: "x" });
        expect(vi.getTimerCount()).toBe(1);

        unmount();
        expect(vi.getTimerCount()).toBe(0);
      } finally {
        vi.useRealTimers();
      }
    });
  });

  describe("given a message streaming while the stored run lags behind", () => {
    /** @scenario "A message keeps streaming while the stored run lags behind" */
    it("keeps streaming into the preview when the stored START row arrives", () => {
      const { result, rerender } = renderStream("run_a");
      send({ e: "S", r: "run_a", m: "m1", l: "assistant", i: 1 });
      send({ e: "C", r: "run_a", m: "m1", d: "Hel" });

      mocks.runState = {
        status: ScenarioRunStatus.IN_PROGRESS,
        messages: [
          { id: "m0", role: "user", content: "hi" },
          { id: "m1", role: "assistant", content: "" },
        ],
      };
      rerender({ runId: "run_a" });
      send({ e: "C", r: "run_a", m: "m1", d: "lo" });

      expect(result.current.streamingMessages).toEqual([
        expect.objectContaining({ messageId: "m1", content: "Hello" }),
      ]);
    });
  });

  describe("when the stored run confirms a completed message", () => {
    it("drops its preview", () => {
      const { result, rerender } = renderStream("run_a");
      send({ e: "S", r: "run_a", m: "m1", l: "assistant", i: 1 });
      send({ e: "E", r: "run_a", m: "m1", c: "Hello" });

      mocks.runState = {
        status: ScenarioRunStatus.IN_PROGRESS,
        messages: [
          { id: "m0", role: "user", content: "hi" },
          { id: "m1", role: "assistant", content: "Hello" },
        ],
      };
      rerender({ runId: "run_a" });
      flushFrames();

      expect(previewIds(result)).toEqual([]);
    });
  });

  describe("when SSE END lands before the stored END", () => {
    /** @scenario "Final text survives an empty stored START row" */
    it("keeps the final text over the empty stored START row", () => {
      const { result, rerender } = renderStream("run_a");
      send({ e: "S", r: "run_a", m: "m1", l: "assistant", i: 1 });
      send({ e: "E", r: "run_a", m: "m1", c: "Hello" });

      mocks.runState = {
        status: ScenarioRunStatus.IN_PROGRESS,
        messages: [
          { id: "m0", role: "user", content: "hi" },
          { id: "m1", role: "assistant", content: "" },
        ],
      };
      rerender({ runId: "run_a" });
      flushFrames();

      expect(result.current.streamingMessages).toEqual([
        expect.objectContaining({ messageId: "m1", content: "Hello" }),
      ]);
    });
  });

  describe("when a lagging read holds part of the final text", () => {
    /** @scenario "Final text stays until the stored text matches it" */
    it("keeps the preview until the stored text matches", () => {
      const { result, rerender } = renderStream("run_a");
      send({ e: "S", r: "run_a", m: "m1", l: "assistant", i: 1 });
      send({ e: "E", r: "run_a", m: "m1", c: "Hello there" });

      mocks.runState = {
        status: ScenarioRunStatus.IN_PROGRESS,
        messages: [
          { id: "m0", role: "user", content: "hi" },
          { id: "m1", role: "assistant", content: "Hello" },
        ],
      };
      rerender({ runId: "run_a" });
      flushFrames();
      expect(previewIds(result)).toEqual(["m1"]);

      mocks.runState = {
        status: ScenarioRunStatus.IN_PROGRESS,
        messages: [
          { id: "m0", role: "user", content: "hi" },
          { id: "m1", role: "assistant", content: "Hello there" },
        ],
      };
      rerender({ runId: "run_a" });
      flushFrames();
      expect(previewIds(result)).toEqual([]);
    });
  });

  describe("when a stored snapshot rolls back a completed message", () => {
    /** @scenario "A stored message snapshot drops every preview of the run" */
    it("drops its preview at once, before any refetch", () => {
      const { result } = renderStream("run_a");
      send({ e: "S", r: "run_a", m: "draft", l: "assistant", i: 1 });
      send({ e: "E", r: "run_a", m: "draft", c: "draft" });

      send({ e: "R", r: "run_a" });

      expect(previewIds(result)).toEqual([]);
    });
  });

  describe("when another run's snapshot is stored", () => {
    it("leaves this run's previews alone", () => {
      const { result } = renderStream("run_a");
      send({ e: "S", r: "run_a", m: "a1", l: "assistant", i: 1 });

      send({ e: "R", r: "run_b" });

      expect(previewIds(result)).toEqual(["a1"]);
    });
  });

  describe("when the run finishes without storing some previews", () => {
    /** @scenario "A finished run drops previews that never landed" */
    it("drops the aborted and the rolled-back previews", () => {
      const { result, rerender } = renderStream("run_a");
      send({ e: "S", r: "run_a", m: "rolled_back", l: "assistant", i: 1 });
      send({ e: "E", r: "run_a", m: "rolled_back", c: "draft" });
      send({ e: "S", r: "run_a", m: "aborted", l: "user", i: 2 });
      send({ e: "C", r: "run_a", m: "aborted", d: "half" });
      expect(previewIds(result)).toEqual(["rolled_back", "aborted"]);

      mocks.runState = {
        status: ScenarioRunStatus.FAILED,
        messages: [{ id: "m0", role: "user", content: "hi" }],
      };
      rerender({ runId: "run_a" });
      flushFrames();

      expect(previewIds(result)).toEqual([]);
    });
  });

  describe("when the drawer switches to another run", () => {
    /** @scenario "Switching runs never shows the previous run's previews" */
    it("shows none of the previous run's previews", () => {
      const { result, rerender } = renderStream("run_a");
      send({ e: "S", r: "run_a", m: "a1", l: "assistant", i: 1 });
      expect(previewIds(result)).toEqual(["a1"]);

      rerender({ runId: "run_b" });
      expect(previewIds(result)).toEqual([]);

      send({ e: "C", r: "run_a", m: "a1", d: "late" });
      send({ e: "S", r: "run_b", m: "b1", l: "assistant", i: 1 });
      expect(previewIds(result)).toEqual(["b1"]);
    });
  });
});
