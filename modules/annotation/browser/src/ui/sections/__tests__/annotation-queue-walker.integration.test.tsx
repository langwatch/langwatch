/**
 * @vitest-environment jsdom
 * The reviewer's queue walk: the bar, the sitting's session count, the end of
 * the queue, and an item whose trace is gone. The conversation and Edit trace
 * are trace's, lent through its declaration, so they stand in here.
 * @see specs/annotations/annotation-queue-workflow.feature
 */

import { useAnnotationQueueSessionStore } from "@langwatch/trace-browser-kit";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  AnnotationTestHarness,
  StubAnnotationHost,
  type StubAnnotationHostOptions,
} from "../../../testing.tsx";
import { AnnotationQueueWalker } from "../annotation-queue-walker.tsx";

type Step = {
  item: {
    id: string;
    traceId: string;
    doneAt: Date | null;
    trace: {
      trace_id: string;
      metadata: Record<string, unknown>;
      timestamps: { started_at: number };
    } | null;
  } | null;
  position: number;
  total: number;
  previousItemId: string | null;
  nextItemId: string | null;
  queueFinished: boolean;
  queueLoading: boolean;
  stepIsStale: boolean;
};

const mocks = vi.hoisted(() => {
  const state: { step?: Step } = {};
  return {
    state,
    markDone: vi.fn(),
    deleteItems: vi.fn(),
    invalidate: vi.fn(async () => {}),
  };
});

vi.mock("../../../behavior/use-annotation-queue-walk.ts", () => ({
  useAnnotationQueueWalk: () => mocks.state.step,
}));

vi.mock("../../../behavior/annotation-api.ts", () => ({
  annotationApi: {
    useUtils: () => ({
      annotation: {
        getQueueWalkStep: { invalidate: mocks.invalidate },
        getPendingItemsCount: { invalidate: mocks.invalidate },
        getAssignedItemsCount: { invalidate: mocks.invalidate },
        getQueueItemsCounts: { invalidate: mocks.invalidate },
      },
    }),
    annotation: {
      markQueueItemDone: { useMutation: () => ({ mutate: mocks.markDone, isPending: false }) },
      deleteQueueItems: { useMutation: () => ({ mutate: mocks.deleteItems, isPending: false }) },
    },
  },
}));

vi.mock("../annotation-queue-layout.tsx", () => ({
  default: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
}));

vi.mock("../../../behavior/lent-trace.tsx", () => ({
  AnnotationQueueConversation: ({
    traceId,
    conversationId,
  }: {
    traceId: string;
    conversationId: string | null;
  }) => <div data-testid="conversation" data-trace={traceId} data-thread={conversationId ?? ""} />,
  TraceEditButton: ({ disabled }: { disabled?: boolean }) => (
    <button type="button" disabled={disabled}>
      Edit trace
    </button>
  ),
}));

function queueItem(id: string, trace = true): NonNullable<Step["item"]> {
  return {
    id,
    traceId: `trace-${id}`,
    doneAt: null,
    trace: trace
      ? {
          trace_id: `trace-${id}`,
          metadata: { thread_id: "thread-1" },
          timestamps: { started_at: 1_700_000_000_000 },
        }
      : null,
  };
}

function stepAt(position: number, overrides: Partial<Step> = {}): Step {
  return {
    item: queueItem(`item-${position}`),
    position,
    total: 3,
    previousItemId: position > 1 ? `item-${position - 1}` : null,
    nextItemId: position < 3 ? `item-${position + 1}` : null,
    queueFinished: false,
    queueLoading: false,
    stepIsStale: false,
    ...overrides,
  };
}

function renderWalker(options: StubAnnotationHostOptions = {}) {
  const host = new StubAnnotationHost(options);
  const utils = render(
    <AnnotationTestHarness host={host}>
      <AnnotationQueueWalker />
    </AnnotationTestHarness>,
  );
  const rerender = () =>
    utils.rerender(
      <AnnotationTestHarness host={host}>
        <AnnotationQueueWalker />
      </AnnotationTestHarness>,
    );
  return { ...utils, host, rerender };
}

/** Answers `markQueueItemDone` as the server would, success first. */
function markDoneSucceeds() {
  mocks.markDone.mockImplementation((_input, handlers: { onSuccess: () => Promise<void> }) => {
    void handlers.onSuccess();
  });
}

beforeEach(() => {
  mocks.state.step = stepAt(2);
  useAnnotationQueueSessionStore.setState({ active: false, marks: {}, handoff: "idle" });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.useRealTimers();
});

describe("given a reviewer walking their annotation queue", () => {
  describe("when the queue item page renders", () => {
    /** @scenario "The queue bar labels its navigation and actions in words" */
    it("names every action on the bar in words", () => {
      renderWalker();

      expect(screen.getByRole("button", { name: /previous/i })).toBeTruthy();
      expect(screen.getByRole("button", { name: "Edit trace" })).toBeTruthy();
      expect(screen.getByRole("button", { name: /next/i })).toBeTruthy();
    });

    /** @scenario "The queue bar shows my position in the queue" */
    it("shows the position in the queue", () => {
      renderWalker();

      expect(screen.getByText("2 of 3")).toBeTruthy();
    });

    /** @scenario "A queued trace is read as the whole thread it belongs to" */
    it("hands trace the item's trace and the thread it belongs to", () => {
      renderWalker();

      const conversation = screen.getByTestId("conversation");
      expect(conversation.dataset.trace).toBe("trace-item-2");
      expect(conversation.dataset.thread).toBe("thread-1");
    });
  });

  describe("when the reviewer has stepped on and the new item is still being read", () => {
    /** @scenario "Nothing acts on the item I have just stepped off" */
    it("holds every action and the conversation, announced as busy", () => {
      mocks.state.step = stepAt(2, { stepIsStale: true });
      renderWalker();

      expect(screen.getByRole("button", { name: /next/i }).hasAttribute("disabled")).toBe(true);
      expect(screen.getByRole("button", { name: "Edit trace" }).hasAttribute("disabled")).toBe(
        true,
      );
      expect(screen.getByTestId("conversation").parentElement?.getAttribute("aria-busy")).toBe(
        "true",
      );
    });
  });

  describe("when the reviewer chooses Next with items left after this one", () => {
    /** @scenario "Next finishes the item and moves on" */
    it("records the item as done and moves on to the next one", async () => {
      markDoneSucceeds();
      const { host } = renderWalker();

      await userEvent.click(screen.getByRole("button", { name: /next/i }));

      expect(mocks.markDone).toHaveBeenCalledWith(
        { queueItemId: "item-2", projectId: "proj-1" },
        expect.anything(),
      );
      await waitFor(() =>
        expect(host.navigations).toContain("/test-project/annotations/my-queue?queue-item=item-3"),
      );
      expect(screen.queryByRole("button", { name: /skip/i })).toBeNull();
    });
  });

  describe("when the reviewer leaves while the move is still settling", () => {
    /** @scenario "Leaving mid-navigation leaves nothing pending behind" */
    it("leaves no settle timer running against the page it left", async () => {
      vi.useFakeTimers();
      markDoneSucceeds();
      const { unmount, host } = renderWalker();

      fireEvent.click(screen.getByRole("button", { name: /next/i }));
      await act(async () => {});
      expect(host.navigations).toHaveLength(1);
      expect(vi.getTimerCount()).toBeGreaterThan(0);

      unmount();

      expect(vi.getTimerCount()).toBe(0);
    });
  });

  describe("given the last item of the queue is open", () => {
    /** @scenario "The last item's primary action reads Done" */
    it("reads Done instead of Next", () => {
      mocks.state.step = stepAt(3);
      renderWalker();

      expect(screen.getByRole("button", { name: /done/i })).toBeTruthy();
      expect(screen.queryByRole("button", { name: /next/i })).toBeNull();
    });
  });

  describe("given the reviewer may not update annotations", () => {
    /** @scenario "A reviewer who cannot update annotations is offered no correction" */
    it("offers no way to edit the trace, and keeps the rest of the bar", () => {
      renderWalker({ permissions: ["annotations:view"] });

      expect(screen.queryByRole("button", { name: "Edit trace" })).toBeNull();
      expect(screen.getByRole("button", { name: /next/i })).toBeTruthy();
    });
  });

  describe("when turns are counted into the session", () => {
    /** @scenario "The turn under review is counted from the start" */
    it("counts the open item's own trace before anything is annotated", () => {
      renderWalker();

      expect(useAnnotationQueueSessionStore.getState().marks).toEqual({ "trace-item-2": "auto" });
    });

    /** @scenario "The dataset toggle carries the live count in traces" */
    it("carries the live count in traces on the toggle", () => {
      renderWalker();

      expect(screen.getByText("Add to dataset at the end (1 trace)")).toBeTruthy();
      act(() => useAnnotationQueueSessionStore.getState().toggle("trace-other"));
      expect(screen.getByText("Add to dataset at the end (2 traces)")).toBeTruthy();
    });

    /** @scenario "An empty session disables the dataset toggle" */
    it("disables the dataset toggle once nothing is counted any more", () => {
      renderWalker();

      act(() => useAnnotationQueueSessionStore.getState().toggle("trace-item-2"));

      expect(screen.getByText("Add to dataset at the end")).toBeTruthy();
      expect(screen.getByRole("checkbox").hasAttribute("disabled")).toBe(true);
    });

    /** @scenario "Session marks belong to the sitting" */
    it("drops the sitting's count on the way out of the queue", () => {
      const { unmount } = renderWalker();

      unmount();

      expect(useAnnotationQueueSessionStore.getState().marks).toEqual({});
      expect(useAnnotationQueueSessionStore.getState().active).toBe(false);
    });
  });

  describe("when the reviewer finishes the last item", () => {
    beforeEach(() => {
      mocks.state.step = stepAt(3);
    });

    /** @scenario "Finishing the last item opens the hand-off over the conversation" */
    it("opens the hand-off over the conversation, and does not celebrate yet", async () => {
      const { host } = renderWalker();

      await userEvent.click(screen.getByRole("checkbox"));
      await userEvent.click(screen.getByRole("button", { name: /done/i }));

      expect(host.drawers).toEqual([
        { name: "addDatasetRecord", params: { selectedTraceIds: ["trace-item-3"] } },
      ]);
      expect(mocks.markDone).not.toHaveBeenCalled();
      expect(screen.queryByText("All tasks complete")).toBeNull();
    });

    /** @scenario "Traces counted earlier in the walk are part of the hand-off" */
    it("includes a trace counted earlier in the walk", async () => {
      useAnnotationQueueSessionStore.setState({ marks: { "trace-item-1": "auto" } });
      const { host } = renderWalker();

      await userEvent.click(screen.getByRole("checkbox"));
      await userEvent.click(screen.getByRole("button", { name: /done/i }));

      expect(host.drawers[0]?.params).toEqual({
        selectedTraceIds: ["trace-item-1", "trace-item-3"],
      });
    });

    /** @scenario "Finishing with the dataset toggle off celebrates directly" */
    it("records the item as done and celebrates when the toggle is off", async () => {
      markDoneSucceeds();
      renderWalker();

      await userEvent.click(screen.getByRole("button", { name: /done/i }));

      expect(mocks.markDone).toHaveBeenCalledTimes(1);
      expect(await screen.findByText("All tasks complete")).toBeTruthy();
    });
  });

  describe("given the hand-off drawer is open for the session's traces", () => {
    async function openHandoff() {
      mocks.state.step = stepAt(3);
      const view = renderWalker();
      await userEvent.click(screen.getByRole("checkbox"));
      await userEvent.click(screen.getByRole("button", { name: /done/i }));
      view.rerender();
      return view;
    }

    /** @scenario "The celebration shows once the records are added" */
    it("records the item as done, celebrates and clears the sitting's set", async () => {
      markDoneSucceeds();
      await openHandoff();

      act(() => useAnnotationQueueSessionStore.getState().noteHandoffAdded());

      expect(await screen.findByText("All tasks complete")).toBeTruthy();
      expect(mocks.markDone).toHaveBeenCalledTimes(1);
      expect(useAnnotationQueueSessionStore.getState().marks).toEqual({});
    });

    /** @scenario "Closing the hand-off without adding asks before ending the session" */
    it("asks before ending the session, and confirming records it done and celebrates", async () => {
      markDoneSucceeds();
      const { host, rerender } = await openHandoff();

      host.openDrawerName = undefined;
      rerender();

      await userEvent.click(await screen.findByRole("button", { name: "Confirm" }));

      expect(mocks.markDone).toHaveBeenCalledTimes(1);
      expect(await screen.findByText("All tasks complete")).toBeTruthy();
    });

    /** @scenario "Cancelling the question lands back on the conversation, nothing finished" */
    it("lands back on the conversation with nothing finished", async () => {
      const { host, rerender } = await openHandoff();

      host.openDrawerName = undefined;
      rerender();
      await userEvent.click(await screen.findByRole("button", { name: "Cancel" }));

      expect(mocks.markDone).not.toHaveBeenCalled();
      expect(screen.getByTestId("conversation")).toBeTruthy();
      expect(useAnnotationQueueSessionStore.getState().handoff).toBe("idle");
    });
  });

  describe("given the queued trace no longer resolves", () => {
    beforeEach(() => {
      mocks.state.step = stepAt(2, { item: queueItem("item-2", false) });
    });

    /** @scenario "An item whose trace is gone says so and offers a way on" */
    it("says the trace is gone and offers removal and skipping", () => {
      renderWalker();

      expect(screen.getByText("This trace is no longer available")).toBeTruthy();
      expect(screen.getByRole("button", { name: "Remove from queue" })).toBeTruthy();
      expect(screen.getByRole("button", { name: "Skip" })).toBeTruthy();
      expect(screen.queryByTestId("conversation")).toBeNull();
    });

    /** @scenario "Removing an item whose trace is gone takes it out of the queue" */
    it("removes the item and moves on", async () => {
      mocks.deleteItems.mockImplementation(
        (_input, handlers: { onSuccess: () => Promise<void> }) => {
          void handlers.onSuccess();
        },
      );
      const { host } = renderWalker();

      await userEvent.click(screen.getByRole("button", { name: "Remove from queue" }));

      expect(mocks.deleteItems).toHaveBeenCalledWith(
        { projectId: "proj-1", queueItemIds: ["item-2"] },
        expect.anything(),
      );
      expect(host.navigations).toContain("/test-project/annotations/my-queue?queue-item=item-3");
    });

    /** @scenario "Skipping an item whose trace is gone leaves it in the queue" */
    it("moves on without removing the item", async () => {
      const { host } = renderWalker();

      await userEvent.click(screen.getByRole("button", { name: "Skip" }));

      expect(mocks.deleteItems).not.toHaveBeenCalled();
      expect(host.navigations).toContain("/test-project/annotations/my-queue?queue-item=item-3");
    });
  });

  describe("given nothing is left to review", () => {
    it("celebrates instead of showing a conversation", () => {
      mocks.state.step = stepAt(1, { item: null, queueFinished: true, position: 0, total: 0 });
      renderWalker();

      expect(screen.getByText("All tasks complete")).toBeTruthy();
    });
  });
});
